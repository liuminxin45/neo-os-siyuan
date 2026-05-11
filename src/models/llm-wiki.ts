export type LlmWikiLayer = "agents" | "wiki" | "raw" | "skills" | "runs";
export type LlmWikiWriteMode = "auto-safe" | "draft-first" | "read-only";
export type KnowledgeOperationStatus = "success" | "error" | "blocked";

export interface LlmWikiSettings {
  enabled: boolean;
  notebookName: string;
  writeMode: LlmWikiWriteMode;
  language: "zh-CN";
  allowedMcpServerIds: string[];
  toolAllowlist: string[];
}

export interface KnowledgeDocMeta {
  path: string;
  layer: LlmWikiLayer;
  kind: string;
  title: string;
  summary: string;
  sourceRefs: string[];
  confidence: "high" | "medium" | "low";
  updatedAt?: string;
}

export interface SkillManifest {
  name: string;
  summary: string;
  triggers: string[];
  sourcePath: string;
  requiredTools: string[];
  writePolicy: LlmWikiWriteMode;
}

export interface AgentPolicySnapshot {
  rules: string[];
  roles: string[];
  toolPolicy: string;
  loadedFrom: string;
  loadedAt: string;
}

export interface KnowledgeOperation {
  operationId: string;
  action: string;
  targetPath: string;
  sourceRefs: string[];
  toolName: string;
  status: KnowledgeOperationStatus;
  createdAt: string;
  summary?: string;
  error?: string;
}

export const LLM_WIKI_DEFAULT_NOTEBOOK = "LLM-Wiki";
export const LLM_WIKI_CONTEXT_HEADER = "LLM-WIKI KNOWLEDGE KERNEL CONTEXT";
export const LLM_WIKI_SAFE_WRITE_MODE: LlmWikiWriteMode = "auto-safe";

export const defaultLlmWikiSettings = (): LlmWikiSettings => ({
  enabled: true,
  notebookName: LLM_WIKI_DEFAULT_NOTEBOOK,
  writeMode: LLM_WIKI_SAFE_WRITE_MODE,
  language: "zh-CN",
  allowedMcpServerIds: [],
  toolAllowlist: [],
});

export const normalizeLlmWikiSettings = (raw: Partial<LlmWikiSettings> | null | undefined): LlmWikiSettings => {
  const fallback = defaultLlmWikiSettings();
  const writeMode =
    raw?.writeMode === "draft-first" || raw?.writeMode === "read-only" || raw?.writeMode === "auto-safe"
      ? raw.writeMode
      : fallback.writeMode;
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : fallback.enabled,
    notebookName: typeof raw?.notebookName === "string" && raw.notebookName.trim()
      ? raw.notebookName.trim()
      : fallback.notebookName,
    writeMode,
    language: "zh-CN",
    allowedMcpServerIds: Array.isArray(raw?.allowedMcpServerIds)
      ? raw.allowedMcpServerIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : fallback.allowedMcpServerIds,
    toolAllowlist: Array.isArray(raw?.toolAllowlist)
      ? raw.toolAllowlist.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : fallback.toolAllowlist,
  };
};

export const stripNotebookPrefix = (path: string, notebookName = LLM_WIKI_DEFAULT_NOTEBOOK): string => {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const prefix = `/${notebookName}`;
  if (normalized === prefix) return "/";
  return normalized.startsWith(`${prefix}/`) ? normalized.slice(prefix.length) : normalized;
};

export const classifyLlmWikiPath = (
  path: string,
  notebookName = LLM_WIKI_DEFAULT_NOTEBOOK,
): LlmWikiLayer | undefined => {
  const hpath = stripNotebookPrefix(path, notebookName);
  if (hpath === "/AGENTS" || hpath.startsWith("/AGENTS/")) return "agents";
  if (hpath === "/wiki" || hpath.startsWith("/wiki/")) return "wiki";
  if (hpath === "/raw" || hpath.startsWith("/raw/")) return "raw";
  if (hpath === "/skills" || hpath.startsWith("/skills/")) return "skills";
  if (hpath === "/runs" || hpath.startsWith("/runs/")) return "runs";
  return undefined;
};

export const isRawEvidenceIntent = (prompt: string): boolean =>
  /原文|全文|证据|来源|raw|source|历史版本|所有资料|完整内容|追溯|出处|原始/.test(prompt);

export const isWriteIntent = (prompt: string): boolean =>
  /保存|记录|写入|创建|新增|更新|归档|导入|摄入|整理|蒸馏|提炼|维护|save|write|record|create|update|ingest|distill/i.test(prompt);

export const isLlmWikiKnowledgeIntent = (prompt: string): boolean =>
  /LLM-Wiki|知识库|知识|笔记|文档|skill|AGENTS|记忆|经验|资料|wiki|raw|runs|skills/i.test(prompt);
