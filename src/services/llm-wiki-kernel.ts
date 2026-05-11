import type { McpTool, McpToolCall } from "../models/mcp";
import type {
  AgentPolicySnapshot,
  KnowledgeDocMeta,
  KnowledgeOperation,
  LlmWikiSettings,
  SkillManifest,
} from "../models/llm-wiki";
import {
  classifyLlmWikiPath,
  defaultLlmWikiSettings,
  isRawEvidenceIntent,
  isWriteIntent,
  LLM_WIKI_CONTEXT_HEADER,
  LLM_WIKI_DEFAULT_NOTEBOOK,
  stripNotebookPrefix,
} from "../models/llm-wiki";
import type { SkillIndexItem } from "../models/skill";
import { createId, nowIso } from "../utils/ids";
import { summarizeJson } from "../utils/masks";
import { SiyuanKnowledgeStore, type KnowledgeSearchResult } from "./siyuan-knowledge-store";

export interface LlmWikiKernelOptions {
  store?: SiyuanKnowledgeStore;
  getSettings?: () => LlmWikiSettings | undefined;
}

export interface LlmWikiContextRequest {
  userGoal: string;
  selectedSkill?: SkillIndexItem;
}

export interface LlmWikiContext {
  policy: AgentPolicySnapshot;
  selectedSkill?: {
    manifest: SkillManifest;
    markdown: string;
  };
  wikiIndex?: string;
  skillsIndex?: string;
  relatedWiki: KnowledgeDocMeta[];
  rawEvidence: KnowledgeDocMeta[];
  warnings: string[];
}

export interface ToolPolicyDecision {
  allowed: boolean;
  reason?: string;
}

const DEFAULT_POLICY_RULES = [
  "LLM-Wiki 的五层核心目录为 AGENTS、wiki、raw、skills、runs。",
  "默认问答优先查 wiki；只有用户要求原文、证据、全文或追溯时才回查 raw。",
  "skills 是能力定义，runs 是审计层；不要把 runs 当作普通知识来源。",
  "允许自动新增、追加、更新；删除、移动、重命名等高风险操作必须先得到用户确认。",
];

const ROLE_NAMES = ["Librarian", "Ingestor", "Curator", "SkillRunner", "SkillMaintainer"];

const MUTATING_ACTIONS = new Set([
  "append",
  "write",
  "replace",
  "create",
  "insert",
  "update",
  "upsert",
  "patch",
  "set_attr",
  "set_attrs",
  "set_cells",
  "add_rows",
  "add_column",
  "create_daily_note",
]);

const DESTRUCTIVE_ACTIONS = new Set([
  "rm",
  "mv",
  "delete",
  "remove",
  "move",
  "rename",
  "remove_rows",
  "remove_column",
  "remove_doc",
  "removeDoc",
  "removeDocByID",
  "deleteBlock",
  "moveBlock",
  "find_replace",
]);

const MUTATING_TOOL_NAME_PATTERN =
  /(?:^|[_-])(write|replace|delete|remove|rm|edit|move|mv|create|append|insert|update|upsert|patch|rename|set)(?:$|[_-])/i;

const compact = (value: string, maxLength = 1200): string => {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
};

const stripMarkdown = (value: string): string =>
  value
    .replace(/^---\n[\s\S]*?\n---\n?/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_\-[\]()`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const summaryFromMarkdown = (value: string, maxLength = 180): string => {
  const cleaned = stripMarkdown(value);
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
};

const parseJsonObject = (value?: string): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const actionFromArgs = (args: Record<string, unknown>): string => {
  const action = args.action;
  return typeof action === "string" ? action : "";
};

const isMutatingCall = (toolName: string, args: Record<string, unknown>): boolean => {
  const action = actionFromArgs(args);
  return MUTATING_ACTIONS.has(action) || DESTRUCTIVE_ACTIONS.has(action) || MUTATING_TOOL_NAME_PATTERN.test(action) || MUTATING_TOOL_NAME_PATTERN.test(toolName);
};

const isDestructiveCall = (toolName: string, args: Record<string, unknown>): boolean => {
  const action = actionFromArgs(args);
  return DESTRUCTIVE_ACTIONS.has(action) || /(?:^|[_-])(delete|remove|rm|move|mv|rename)(?:$|[_-])/i.test(action) || /(?:^|[_-])(delete|remove|rm|move|mv|rename)(?:$|[_-])/i.test(toolName);
};

const targetFromArgs = (args: Record<string, unknown>): string => {
  const candidates = ["path", "from", "to", "targetPath", "id", "blockID", "blockId", "docId"];
  return candidates.map((key) => args[key]).find((value): value is string => typeof value === "string" && value.trim().length > 0) || "";
};

const queryTerms = (value: string): string[] =>
  value
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 6);

const resultToMeta = (result: KnowledgeSearchResult): KnowledgeDocMeta => ({
  path: result.path,
  layer: result.layer,
  kind: "document",
  title: result.title,
  summary: result.summary,
  sourceRefs: [],
  confidence: "medium",
  updatedAt: result.updated,
});

class PolicyLoader {
  constructor(private readonly store: SiyuanKnowledgeStore) {}

  async load(settings: LlmWikiSettings): Promise<AgentPolicySnapshot> {
    const loadedAt = nowIso();
    const path = `/${settings.notebookName}/AGENTS`;
    const markdown = await this.store.readDocumentMarkdown(path, settings.notebookName);
    const rules = markdown
      ? markdown
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/.test(line))
        .map((line) => line.replace(/^[-*]\s+/, ""))
        .slice(0, 24)
      : DEFAULT_POLICY_RULES;
    return {
      rules: rules.length ? rules : DEFAULT_POLICY_RULES,
      roles: ROLE_NAMES,
      toolPolicy: "auto-safe: create/append/update allowed; delete/move/rename require explicit user confirmation",
      loadedFrom: markdown ? path : "builtin-default-policy",
      loadedAt,
    };
  }
}

class SkillRegistry {
  constructor(private readonly store: SiyuanKnowledgeStore) {}

  async list(settings: LlmWikiSettings): Promise<SkillManifest[]> {
    return this.store.listSkillManifests(settings.notebookName);
  }

  async loadSelected(settings: LlmWikiSettings, selected?: SkillIndexItem): Promise<LlmWikiContext["selectedSkill"]> {
    if (!selected) return undefined;
    const markdown = await this.store.readDocumentMarkdown(selected.sourcePath, settings.notebookName);
    const manifest: SkillManifest = {
      name: selected.name,
      summary: selected.summary || summaryFromMarkdown(markdown || ""),
      triggers: [selected.name],
      sourcePath: selected.sourcePath,
      requiredTools: ["mcp.fs"],
      writePolicy: settings.writeMode,
    };
    return {
      manifest,
      markdown: markdown || `未能读取完整 SKILL 文档：${selected.sourcePath}`,
    };
  }
}

class ContextAssembler {
  constructor(private readonly store: SiyuanKnowledgeStore, private readonly policyLoader: PolicyLoader, private readonly skillRegistry: SkillRegistry) {}

  async assemble(settings: LlmWikiSettings, request: LlmWikiContextRequest): Promise<LlmWikiContext> {
    const warnings: string[] = [];
    let policy: AgentPolicySnapshot;
    try {
      policy = await this.policyLoader.load(settings);
    } catch (error) {
      policy = {
        rules: DEFAULT_POLICY_RULES,
        roles: ROLE_NAMES,
        toolPolicy: "auto-safe fallback",
        loadedFrom: "builtin-default-policy",
        loadedAt: nowIso(),
      };
      warnings.push(error instanceof Error ? error.message : String(error));
    }

    const [selectedSkill, wikiIndex, skillsIndex, relatedWiki, rawEvidence] = await Promise.all([
      this.skillRegistry.loadSelected(settings, request.selectedSkill).catch((error) => {
        warnings.push(error instanceof Error ? error.message : String(error));
        return undefined;
      }),
      this.store.readDocumentMarkdown(`/${settings.notebookName}/wiki/index`, settings.notebookName).catch(() => undefined),
      this.store.readDocumentMarkdown(`/${settings.notebookName}/skills/index`, settings.notebookName).catch(() => undefined),
      this.searchLayer(settings, request.userGoal, "wiki").catch((error) => {
        warnings.push(error instanceof Error ? error.message : String(error));
        return [];
      }),
      isRawEvidenceIntent(request.userGoal)
        ? this.searchLayer(settings, request.userGoal, "raw").catch((error) => {
          warnings.push(error instanceof Error ? error.message : String(error));
          return [];
        })
        : Promise.resolve([]),
    ]);

    return {
      policy,
      selectedSkill,
      wikiIndex,
      skillsIndex,
      relatedWiki,
      rawEvidence,
      warnings,
    };
  }

  private async searchLayer(settings: LlmWikiSettings, prompt: string, layer: "wiki" | "raw"): Promise<KnowledgeDocMeta[]> {
    const terms = queryTerms(prompt);
    const query = terms[0] || prompt.slice(0, 24);
    if (!query.trim()) return [];
    const results = await this.store.searchDocuments(query, { notebookName: settings.notebookName, layer, limit: 5 });
    return results.map(resultToMeta);
  }
}

class McpToolPolicy {
  filterTools(tools: McpTool[], settings: LlmWikiSettings): McpTool[] {
    if (!settings.enabled) return tools;
    return tools.filter((tool) => {
      const serverAllowed =
        settings.allowedMcpServerIds.length === 0 || settings.allowedMcpServerIds.includes(tool.serverId);
      const toolAllowed =
        settings.toolAllowlist.length === 0 || settings.toolAllowlist.includes(tool.llmName) || settings.toolAllowlist.includes(tool.name);
      return serverAllowed && toolAllowed;
    });
  }

  authorize(tool: McpTool, args: Record<string, unknown>, settings: LlmWikiSettings): ToolPolicyDecision {
    if (!settings.enabled) return { allowed: true };
    if (!this.filterTools([tool], settings).length) {
      return { allowed: false, reason: `LLM-Wiki 工具策略阻止了未授权工具：${tool.llmName}` };
    }
    if (!isMutatingCall(tool.llmName, args)) return { allowed: true };
    if (settings.writeMode === "read-only") {
      return { allowed: false, reason: "LLM-Wiki 当前为只读模式，写入类 MCP 调用已被阻止。" };
    }
    if (settings.writeMode === "draft-first") {
      return { allowed: false, reason: "LLM-Wiki 当前要求先输出变更草案，确认后才能执行写入。" };
    }
    if (isDestructiveCall(tool.llmName, args)) {
      return { allowed: false, reason: "LLM-Wiki auto-safe 模式要求删除、移动、重命名等高风险操作先获得用户明确确认。" };
    }
    return { allowed: true };
  }
}

class WriteLedger {
  constructor(private readonly store: SiyuanKnowledgeStore) {}

  async record(settings: LlmWikiSettings, call: McpToolCall): Promise<KnowledgeOperation | undefined> {
    const args = parseJsonObject(call.argumentsSummary);
    if (call.status !== "success" || !isMutatingCall(call.llmName || call.toolName, args)) return undefined;
    const createdAt = nowIso();
    const operation: KnowledgeOperation = {
      operationId: createId("op"),
      action: actionFromArgs(args) || call.toolName,
      targetPath: targetFromArgs(args) || "未返回明确目标",
      sourceRefs: [],
      toolName: call.llmName || call.toolName,
      status: "success",
      createdAt,
      summary: call.outputSummary || "工具调用成功",
    };
    const day = createdAt.slice(0, 10);
    const path = `/${settings.notebookName}/runs/ledger/${day}/${operation.operationId}`;
    await this.store.ensureDocumentPath(`/${settings.notebookName}/runs/ledger/${day}`, settings.notebookName);
    await this.store.createDocumentWithMarkdown(path, this.toMarkdown(operation), settings.notebookName);
    return operation;
  }

  private toMarkdown(operation: KnowledgeOperation): string {
    return [
      `# ${operation.operationId}`,
      "",
      `- action: ${operation.action}`,
      `- targetPath: ${operation.targetPath}`,
      `- toolName: ${operation.toolName}`,
      `- status: ${operation.status}`,
      `- createdAt: ${operation.createdAt}`,
      "",
      "## Summary",
      "",
      compact(operation.summary || "", 1200) || "工具调用成功。",
    ].join("\n");
  }
}

export class LlmWikiKernel {
  private readonly store: SiyuanKnowledgeStore;
  private readonly policyLoader: PolicyLoader;
  private readonly skillRegistry: SkillRegistry;
  private readonly contextAssembler: ContextAssembler;
  private readonly toolPolicy = new McpToolPolicy();
  private readonly writeLedger: WriteLedger;

  constructor(private readonly options: LlmWikiKernelOptions = {}) {
    this.store = options.store || new SiyuanKnowledgeStore();
    this.policyLoader = new PolicyLoader(this.store);
    this.skillRegistry = new SkillRegistry(this.store);
    this.contextAssembler = new ContextAssembler(this.store, this.policyLoader, this.skillRegistry);
    this.writeLedger = new WriteLedger(this.store);
  }

  settings(): LlmWikiSettings {
    return this.options.getSettings?.() || defaultLlmWikiSettings();
  }

  async assemblePrompt(userPrompt: string, request: LlmWikiContextRequest): Promise<string> {
    const settings = this.settings();
    if (!settings.enabled) return userPrompt;
    const context = await this.contextAssembler.assemble(settings, request);
    return [this.formatContext(context, settings), userPrompt].filter(Boolean).join("\n\n");
  }

  filterTools(tools: McpTool[]): McpTool[] {
    return this.toolPolicy.filterTools(tools, this.settings());
  }

  authorizeToolCall(tool: McpTool, args: Record<string, unknown>): ToolPolicyDecision {
    return this.toolPolicy.authorize(tool, args, this.settings());
  }

  async recordToolOperation(call: McpToolCall): Promise<KnowledgeOperation | undefined> {
    const settings = this.settings();
    if (!settings.enabled) return undefined;
    return this.writeLedger.record(settings, call);
  }

  private formatContext(context: LlmWikiContext, settings: LlmWikiSettings): string {
    const notebook = settings.notebookName || LLM_WIKI_DEFAULT_NOTEBOOK;
    const related = context.relatedWiki
      .map((item) => `- ${item.title} (${stripNotebookPrefix(item.path, notebook)}): ${item.summary}`)
      .join("\n");
    const raw = context.rawEvidence
      .map((item) => `- ${item.title} (${stripNotebookPrefix(item.path, notebook)}): ${item.summary}`)
      .join("\n");
    return [
      `# ${LLM_WIKI_CONTEXT_HEADER}`,
      "",
      `notebook: ${notebook}`,
      `writeMode: ${settings.writeMode}`,
      "",
      "## AGENTS Policy Snapshot",
      `loadedFrom: ${context.policy.loadedFrom}`,
      context.policy.rules.map((rule) => `- ${rule}`).join("\n"),
      `roles: ${context.policy.roles.join(", ")}`,
      `toolPolicy: ${context.policy.toolPolicy}`,
      "",
      "## Context Order",
      "- AGENTS -> selected skill -> wiki index -> related wiki -> raw evidence only when explicitly requested.",
      "- 普通知识问答不要把 runs 当作知识来源；runs 只用于审计、恢复、排错。",
      "- 需要写入时优先 raw 备份，再写 wiki 结论，并在最终回答说明来源和变更。",
      "",
      context.selectedSkill
        ? [
          "## Selected Skill",
          `name: ${context.selectedSkill.manifest.name}`,
          `sourcePath: ${context.selectedSkill.manifest.sourcePath}`,
          `summary: ${context.selectedSkill.manifest.summary}`,
          "```markdown",
          compact(context.selectedSkill.markdown, 5200),
          "```",
        ].join("\n")
        : "",
      context.wikiIndex
        ? ["## Wiki Index Excerpt", "```markdown", compact(context.wikiIndex, 1800), "```"].join("\n")
        : "",
      context.skillsIndex
        ? ["## Skills Index Excerpt", "```markdown", compact(context.skillsIndex, 1600), "```"].join("\n")
        : "",
      related ? ["## Related Wiki Candidates", related].join("\n") : "",
      raw ? ["## Raw Evidence Candidates", raw].join("\n") : "",
      context.warnings.length ? ["## Kernel Warnings", context.warnings.map((warning) => `- ${warning}`).join("\n")].join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}

export const shouldUseLlmWikiKernel = (prompt: string, selectedSkill?: SkillIndexItem): boolean =>
  Boolean(selectedSkill) || isWriteIntent(prompt) || /LLM-Wiki|知识库|skill|AGENTS|wiki|raw|runs|skills/i.test(prompt);
