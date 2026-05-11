import { streamChatCompletion, type LlmStreamResult } from "../adapters/llm-chat-completions";
import type { ChatMessage } from "../models/chat";
import type { LlmProfile } from "../models/llm";
import type { McpTool, McpToolCall } from "../models/mcp";
import {
  DEFAULT_AGENT_MODE,
  REACT_PAUSE_MESSAGE,
  REACT_SEGMENT_ROUNDS,
  normalizeAgentMode,
  type AgentMode,
  type ReActContinuationState,
  type ReActStep,
} from "../models/agent";
import { LLM_WIKI_CONTEXT_HEADER } from "../models/llm-wiki";
import { createId, nowIso } from "../utils/ids";
import { summarizeJson } from "../utils/masks";

export interface AgentRuntimeInput {
  mode?: AgentMode;
  profile: LlmProfile;
  messages: ChatMessage[];
  tools: McpTool[];
  signal?: AbortSignal;
  continuation?: ReActContinuationState;
}

export interface AgentRuntimeHandlers {
  onText: (chunk: string) => void;
  onStep: (step: ReActStep) => void;
  onToolStart: (tool: McpTool, args: Record<string, unknown>, requestId?: string) => McpToolCall;
  onToolFinish: (call: McpToolCall) => void;
  callTool: (tool: McpTool, args: Record<string, unknown>) => Promise<McpToolCall>;
}

export interface AgentRuntimeResult {
  status: "final" | "paused";
  content: string;
  toolResults: McpToolCall[];
  completedRounds: number;
  reactHistory: string[];
  pauseReason?: string;
}

const thoughtFromResult = (result: LlmStreamResult, hasTools: boolean, hasPriorObservations: boolean): string => {
  const content = result.content.trim();
  if (hasTools && content) return content;
  if (!hasTools) return hasPriorObservations ? "根据已有 Observation 整理最终回答。" : "判断无需调用工具，可以直接回答。";
  return hasTools ? "判断需要调用工具获取信息。" : "判断无需调用工具，可以直接回答。";
};

const parseArgumentSummary = (summary: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(summary) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const actionThought = (step: ReActStep): string => {
  const firstAction = step.actions[0];
  if (!firstAction) return step.thought;
  const args = parseArgumentSummary(firstAction.argumentsSummary);
  if (isHelpArgs(args)) {
    return `需要先查看 ${firstAction.toolName} 的可用动作和参数约束。`;
  }
  const action = typeof args.action === "string" ? args.action : "";
  const query =
    typeof args.query === "string"
      ? args.query
      : typeof args.keyword === "string"
        ? args.keyword
        : typeof args.sql === "string"
          ? "SQL"
          : "";
  if (action && query) return `基于已有 Observation，调用 ${firstAction.toolName} 的 ${action} 动作查询 ${query}。`;
  if (action) return `基于已有 Observation，调用 ${firstAction.toolName} 的 ${action} 动作继续获取信息。`;
  return `基于用户目标，调用 ${firstAction.toolName} 获取下一步所需信息。`;
};

const observationSummary = (call: McpToolCall): string =>
  call.status === "success" ? call.outputSummary || "工具调用成功" : call.error || call.status;

const DUPLICATE_GUARD_PREFIX = "REACT_DUPLICATE_GUARD:";
const REPEAT_GUARD_PREFIX = "REACT_REPEAT_GUARD:";

interface ToolCallRecord {
  count: number;
  status: McpToolCall["status"];
  summary: string;
  workspaceVersion: number;
}

const syntheticHistoryMessage = (content: string): ChatMessage => ({
  id: createId("msg"),
  role: "user",
  content,
  createdAt: nowIso(),
  status: "complete",
});

const formatReActHistoryEntry = (step: ReActStep): string => {
  const actions = step.actions.length
    ? step.actions.map((action) => `${action.toolName} ${action.argumentsSummary}`).join("\n")
    : "无";
  const observations = step.observations.length
    ? step.observations.map((observation) => `${observation.status}：${observation.summary}`).join("\n")
    : "无";
  const usedHelp = step.actions.some((action) => /"action"\s*:\s*"help"/.test(action.argumentsSummary));
  const skippedDuplicate = step.observations.some((observation) => observation.summary.startsWith(DUPLICATE_GUARD_PREFIX));
  return [
    "ReAct 历史：",
    `第 ${step.round} 轮`,
    `Thought：${step.thought}`,
    `Action：${actions}`,
    `Observation：${observations}`,
    "下一步必须基于上述 Observation 继续推理；不要忽略已经返回的工具结果。",
    usedHelp ? "注意：help 已经返回工具用法，下一轮不要重复 help；请改用具体 action 和必填参数，或在信息足够时给出最终回答。" : "",
    skippedDuplicate ? "注意：重复工具调用已被跳过。不要因此直接结束；请改用其它参数、其它候选目标或其它工具继续完成用户目标。" : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const actionValuesForTool = (tool: McpTool): string[] => {
  const action = ((tool.inputSchema?.properties || {}) as Record<string, unknown>).action as { enum?: unknown[] } | undefined;
  return Array.isArray(action?.enum) ? action.enum.filter((item): item is string => typeof item === "string") : [];
};

const isHelpArgs = (args: Record<string, unknown>): boolean => args.action === "help";

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const toolCallSignature = (tool: McpTool, args: Record<string, unknown>): string => `${tool.llmName}:${stableJson(args)}`;

const searchIntentSignature = (tool: McpTool, args: Record<string, unknown>): string | undefined => {
  const action = typeof args.action === "string" ? args.action : "";
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (action !== "search" || !query) return undefined;
  const path = typeof args.path === "string" ? args.path.trim() || "/" : "/";
  return `${tool.llmName}:search:${path}:${query}`;
};

const readIntentSignature = (tool: McpTool, args: Record<string, unknown>): string | undefined => {
  const action = typeof args.action === "string" ? args.action : "";
  if (action !== "read" && action !== "get_doc") return undefined;
  const target =
    typeof args.path === "string"
      ? args.path.trim()
      : typeof args.id === "string"
        ? args.id.trim()
        : "";
  return target ? `${tool.llmName}:${action}:${target}` : undefined;
};

const MUTATING_ACTIONS = new Set([
  "append",
  "write",
  "replace",
  "rm",
  "delete",
  "edit",
  "mv",
  "create",
  "insert",
  "update",
  "upsert",
  "patch",
  "rename",
  "remove",
  "move",
  "set_attr",
  "set_conf",
  "set_icon",
  "set_open_state",
  "set_permission",
  "find_replace",
  "duplicate",
  "heading_to_doc",
  "doc_to_heading",
  "create_daily_note",
]);

const MUTATING_TOOL_NAME_PATTERN =
  /(?:^|[_-])(write|replace|delete|remove|rm|edit|move|mv|create|append|insert|update|upsert|patch|rename)(?:$|[_-])/i;

interface MutationRecord {
  index: number;
  operation: string;
  target: string;
  tool: string;
  result: string;
}

interface DocumentReferenceRecord {
  title: string;
  path: string;
  id?: string;
}

const isMutatingCall = (args: Record<string, unknown>, toolName = ""): boolean => {
  const action = typeof args.action === "string" ? args.action : "";
  return MUTATING_ACTIONS.has(action) || MUTATING_TOOL_NAME_PATTERN.test(action) || MUTATING_TOOL_NAME_PATTERN.test(toolName);
};

const stringArg = (args: Record<string, unknown>, names: string[]): string => {
  for (const name of names) {
    const value = args[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const mutationOperationLabel = (args: Record<string, unknown>, toolName: string): string => {
  const action = typeof args.action === "string" ? args.action : "";
  const normalized = action.toLowerCase();
  if (/write|create/.test(normalized)) return "创建/写入文档";
  if (/replace|edit|find_replace|patch/.test(normalized)) return "编辑文档";
  if (/append|insert|update|upsert/.test(normalized)) return "追加/更新内容";
  if (/^rm$|remove|delete/.test(normalized)) return "删除文档";
  if (/^mv$|move/.test(normalized)) return "移动文档";
  if (/rename/.test(normalized)) return "重命名文档";
  if (normalized.startsWith("set_") || normalized === "set") return "更新设置/属性";
  return action || toolName || "变更操作";
};

const mutationTargetLabel = (args: Record<string, unknown>): string => {
  const source = stringArg(args, ["path", "from", "sourcePath", "src", "id", "blockId", "docId"]);
  const target = stringArg(args, ["to", "targetPath", "dest", "destination", "newPath", "newId"]);
  if (source && target) return `${source} -> ${target}`;
  return source || target || "未返回明确目标";
};

const sanitizeLedgerCell = (value: string, maxLength = 140): string => {
  const compact = value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
};

const stripHighlights = (value: string): string => value.replace(/<\/?mark>/g, "").replace(/<[^>]*>/g, "");

const cleanDocTitle = (value: string): string =>
  stripHighlights(value)
    .replace(/\s+/g, " ")
    .trim();

const normalizeDocPath = (path: string, notebookName?: string): string => {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) return "";
  if (notebookName && normalized.startsWith(`/${notebookName}/`)) return normalized;
  if (/^\/?(wiki|raw|runs|skills)\//i.test(normalized)) {
    return notebookName ? `/${notebookName}${normalized.startsWith("/") ? normalized : `/${normalized}`}` : normalized;
  }
  return normalized;
};

const documentReferencesFromValue = (value: unknown): DocumentReferenceRecord[] => {
  if (Array.isArray(value)) return value.flatMap(documentReferencesFromValue);
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const notebookName = typeof item.notebookName === "string" ? item.notebookName : undefined;
  const type = typeof item.type === "string" ? item.type : "";
  const id =
    typeof item.rootID === "string"
      ? item.rootID
      : typeof item.parentID === "string"
        ? item.parentID
        : typeof item.id === "string"
          ? item.id
          : undefined;
  const rawPath =
    typeof item.hPath === "string"
      ? item.hPath
      : typeof item.hpath === "string"
        ? item.hpath
        : typeof item.path === "string"
          ? item.path
          : "";
  const path = normalizeDocPath(rawPath, notebookName);
  const title = cleanDocTitle(
    (typeof item.plainContent === "string" && item.plainContent) ||
      (typeof item.content === "string" && item.content) ||
      path.split("/").filter(Boolean).pop() ||
      "",
  );
  const looksLikeDoc = /NodeDocument|NodeHeading|document|heading/i.test(type) || /^\/?LLM-Wiki\/(wiki|raw|runs|skills)\//i.test(path) || /^\/?(wiki|raw|runs|skills)\//i.test(path);
  return looksLikeDoc && title && path ? [{ title, path, id }] : [];
};

const parseToolOutputJson = (summary: string): unknown | undefined => {
  try {
    const parsed = JSON.parse(summary) as unknown;
    if (typeof parsed === "object" && parsed !== null && "content" in parsed) {
      const content = (parsed as { content?: unknown }).content;
      if (Array.isArray(content)) {
        const text = content
          .map((item) => (typeof item === "object" && item !== null ? (item as { text?: unknown }).text : undefined))
          .filter((item): item is string => typeof item === "string")
          .join("\n");
        if (text) return parseToolOutputJson(text) ?? parsed;
      }
    }
    return parsed;
  } catch {
    const candidate = summary.match(/\{[\s\S]*\}/)?.[0] || summary.match(/\[[\s\S]*\]/)?.[0];
    if (candidate && candidate !== summary) return parseToolOutputJson(candidate);
    return undefined;
  }
};

const dedupeDocumentReferences = (references: DocumentReferenceRecord[]): DocumentReferenceRecord[] => {
  const seen = new Set<string>();
  const result: DocumentReferenceRecord[] = [];
  for (const reference of references) {
    const key = reference.id || `${reference.title}|${reference.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
};

const documentReferencesFromResults = (toolResults: McpToolCall[]): DocumentReferenceRecord[] =>
  dedupeDocumentReferences(
    toolResults
      .filter((result) => result.status === "success" && result.outputSummary)
      .flatMap((result) => documentReferencesFromValue(parseToolOutputJson(result.outputSummary || "")))
      .slice(0, 20),
  );

const linkedTitle = (reference: DocumentReferenceRecord): string =>
  reference.id
    ? `[${reference.title}](siyuan-doc://${reference.id})`
    : `[${reference.title}](${reference.path})`;

const bindDocumentLinks = (content: string, toolResults: McpToolCall[]): string => {
  const references = documentReferencesFromResults(toolResults);
  if (references.length === 0) return content;
  let next = content;
  for (const reference of references) {
    const escapedTitle = reference.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const alreadyLinked = new RegExp(`\\[[^\\]]*${escapedTitle}[^\\]]*]\\([^)]*\\)`).test(next);
    if (!alreadyLinked) {
      next = next.replace(new RegExp(`\\*\\*${escapedTitle}\\*\\*`, "g"), `**${linkedTitle(reference)}**`);
      next = next.replace(new RegExp(`(?<!\\[)${escapedTitle}(?![\\]\\)])`, "g"), linkedTitle(reference));
    }
    const pathLine = new RegExp(`路径：\`?${reference.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`?`, "g");
    next = next.replace(pathLine, `路径：${linkedTitle(reference)}`);
  }
  return next;
};

const mutationRecordsFromResults = (toolResults: McpToolCall[]): MutationRecord[] =>
  toolResults
    .map((result, index) => {
      const args = parseArgumentSummary(result.argumentsSummary || "{}");
      if (result.status !== "success" || !isMutatingCall(args, result.llmName || result.toolName)) return undefined;
      return {
        index: index + 1,
        operation: sanitizeLedgerCell(mutationOperationLabel(args, result.llmName || result.toolName), 48),
        target: sanitizeLedgerCell(mutationTargetLabel(args), 96),
        tool: sanitizeLedgerCell(result.llmName || result.toolName, 64),
        result: sanitizeLedgerCell(result.outputSummary || "工具返回成功", 160),
      };
    })
    .filter((record): record is MutationRecord => Boolean(record));

const formatMutationLedger = (toolResults: McpToolCall[]): string => {
  const records = mutationRecordsFromResults(toolResults);
  if (records.length === 0) return "";
  return [
    "## 实际变更清单",
    "",
    "| # | 操作 | 目标 | 工具 | 结果 |",
    "|---:|---|---|---|---|",
    ...records.map((record, index) =>
      `| ${index + 1} | ${record.operation} | ${record.target} | ${record.tool} | ${record.result} |`,
    ),
  ].join("\n");
};

const finalizeAgentContent = (content: string, toolResults: McpToolCall[]): string => {
  const trimmed = bindDocumentLinks(content.trim(), toolResults);
  const ledger = formatMutationLedger(toolResults);
  if (!ledger) return trimmed;
  return [trimmed || "已完成。", ledger].join("\n\n");
};

const writeBodyFromArgs = (args: Record<string, unknown>): string =>
  [args.markdown, args.content, args.body, args.text, args.new]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .trim();

const isSelectedSkillGoal = (goal: string): boolean => /已选 skill：/.test(goal);

const isLlmWikiRuntimeGoal = (goal: string): boolean => goal.includes(LLM_WIKI_CONTEXT_HEADER);

const runtimeUserIntent = (goal: string): string => {
  const skillGoal = goal.match(/(?:^|\n)用户目标：([^\n]+)/);
  if (skillGoal?.[1]?.trim()) return skillGoal[1].trim();
  if (!isLlmWikiRuntimeGoal(goal)) return goal;
  const blocks = goal
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks[blocks.length - 1] || goal;
};

const hasWorkspaceMutationIntent = (goal: string): boolean =>
  /记下|记录|保存|写入|创建|新增|更新|归档|摄入|导入|蒸馏|提炼|distill|ingest|write|save|record|create|update/i.test(runtimeUserIntent(goal));

const requiresSuccessfulMutation = (goal: string): boolean =>
  (isSelectedSkillGoal(goal) || isLlmWikiRuntimeGoal(goal)) && hasWorkspaceMutationIntent(goal);

const hasSuccessfulMutation = (toolResults: McpToolCall[]): boolean =>
  toolResults.some((result) =>
    result.status === "success" && isMutatingCall(parseArgumentSummary(result.argumentsSummary || "{}"), result.llmName || result.toolName),
  );

const stepHasSuccessfulMutation = (step: ReActStep): boolean =>
  step.actions.some((action) => {
    const args = parseArgumentSummary(action.argumentsSummary);
    return isMutatingCall(args, action.toolName) && step.observations.some((observation) => observation.status === "success");
  });

const requiredGoalMarkers = (goal: string): string[] => {
  const markers = new Set<string>();
  const intent = runtimeUserIntent(goal);
  const date = intent.match(/\d{4}年\d{1,2}月\d{1,2}/)?.[0] || intent.match(/\d{4}-\d{1,2}-\d{1,2}/)?.[0];
  if (date) markers.add(date);
  for (const match of intent.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}(?:\s+[A-Za-z][A-Za-z0-9_-]{2,})*/g)) {
    const value = match[0].trim();
    if (!/skill|write|save|record|mcp/i.test(value)) markers.add(value);
  }
  return [...markers].slice(0, 3);
};

const mutationContentError = (args: Record<string, unknown>, userGoal: string): string | undefined => {
  if (args.action !== "write" && args.action !== "replace" && args.action !== "create") return undefined;
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const body = writeBodyFromArgs(args);
  if (args.action === "write" && path.endsWith("/")) {
    return "写入文档时 path 不能以 / 结尾。用户给的是目录时，必须在该目录下补一个明确文档名，例如 /LLM-Wiki/wiki/memory/insights/<文档标题>。";
  }
  if (!body) {
    return "写入类 MCP 调用不能使用空内容。请把用户要保存的事实写入 markdown/content 后再调用。";
  }
  const missing = requiredGoalMarkers(userGoal).filter((marker) => !body.includes(marker));
  if (missing.length > 0) {
    return `写入内容缺少用户目标中的关键信息：${missing.join(", ")}。不要写通用模板，必须保存用户明确给出的事实。`;
  }
  return undefined;
};

const isRetryableSummary = (summary: string): boolean =>
  /retry|timeout|temporar|closed-or-initializing|initializing|rate limit|429|5\d\d|稍后|重试|初始化|超时|暂时/i.test(summary);

const toolGuardReason = (
  tool: McpTool,
  args: Record<string, unknown>,
  exactRecords: Map<string, ToolCallRecord>,
  currentStepSignatures: Set<string>,
  searchIntentCounts: Map<string, number>,
  readIntentCounts: Map<string, number>,
  workspaceVersion: number,
): string | undefined => {
  const signature = toolCallSignature(tool, args);
  if (currentStepSignatures.has(signature)) {
    return `${DUPLICATE_GUARD_PREFIX} 已跳过同一轮内完全相同的重复工具调用 ${tool.llmName} ${summarizeJson(args, 240)}。这不代表任务失败；请阅读已有 Observation，改用其它参数/其它目标继续，或在信息足够时给出最终回答。`;
  }

  const previous = exactRecords.get(signature);
  if (previous && previous.workspaceVersion === workspaceVersion) {
    if (previous.status === "success") {
      return `${DUPLICATE_GUARD_PREFIX} 相同工具调用此前已经成功：${tool.llmName} ${summarizeJson(args, 240)}。请直接使用已有 Observation，不要重复读取同一结果。`;
    }
    if (!isRetryableSummary(previous.summary)) {
      return `${DUPLICATE_GUARD_PREFIX} 相同工具调用此前已经返回不可重试结果：${previous.summary}。请换目标、换参数、换工具，或向用户说明限制。`;
    }
    if (previous.count >= 2) {
      return `${DUPLICATE_GUARD_PREFIX} 相同工具调用已因可重试错误尝试过 ${previous.count} 次：${previous.summary}。请换目标、换参数、换工具，或向用户说明限制。`;
    }
  }

  const searchSignature = searchIntentSignature(tool, args);
  if (searchSignature && (searchIntentCounts.get(searchSignature) || 0) >= 3) {
    return `${REPEAT_GUARD_PREFIX} 已经围绕同一个 search 查询反复检索 3 次以上：${summarizeJson(args, 240)}。这属于无进展检索。请停止分页/扩大 pageSize，改用已有结果中的具体 path 读取，或明确说明无法唯一确定。`;
  }

  const readSignature = readIntentSignature(tool, args);
  if (readSignature && (readIntentCounts.get(readSignature) || 0) > 0) {
    return `${REPEAT_GUARD_PREFIX} 已经读取过同一个目标：${summarizeJson(args, 240)}。不要通过修改 page/pageSize 或换工具重复读取；请基于已读内容给出最终回答。`;
  }

  return undefined;
};

const rememberToolCallAttempt = (
  tool: McpTool,
  args: Record<string, unknown>,
  currentStepSignatures: Set<string>,
  searchIntentCounts: Map<string, number>,
  readIntentCounts: Map<string, number>,
): void => {
  const signature = toolCallSignature(tool, args);
  currentStepSignatures.add(signature);
  const searchSignature = searchIntentSignature(tool, args);
  if (searchSignature) {
    searchIntentCounts.set(searchSignature, (searchIntentCounts.get(searchSignature) || 0) + 1);
  }
  const readSignature = readIntentSignature(tool, args);
  if (readSignature) {
    readIntentCounts.set(readSignature, (readIntentCounts.get(readSignature) || 0) + 1);
  }
};

const rememberToolCallResult = (
  tool: McpTool,
  args: Record<string, unknown>,
  result: McpToolCall,
  exactRecords: Map<string, ToolCallRecord>,
  workspaceVersion: number,
): void => {
  const signature = toolCallSignature(tool, args);
  const previous = exactRecords.get(signature);
  const summary = observationSummary(result);
  if (previous && result.status === "stopped" && summary.startsWith(DUPLICATE_GUARD_PREFIX)) {
    exactRecords.set(signature, { ...previous, count: previous.count + 1 });
    return;
  }
  exactRecords.set(signature, {
    count: (previous?.count || 0) + 1,
    status: result.status,
    summary,
    workspaceVersion,
  });
};

const stepHitRepeatGuard = (step: ReActStep): boolean =>
  step.observations.some((observation) => observation.summary.startsWith(REPEAT_GUARD_PREFIX));

const stepHitDuplicateGuard = (step: ReActStep): boolean =>
  step.observations.some((observation) => observation.summary.startsWith(DUPLICATE_GUARD_PREFIX));

const stepHasSuccessfulRead = (step: ReActStep): boolean =>
  step.actions.some((action) => {
    const args = parseArgumentSummary(action.argumentsSummary);
    return (args.action === "read" || args.action === "get_doc") && step.observations.some((observation) => observation.status === "success");
  });

const shouldFinalizeAfterRead = (step: ReActStep, userGoal: string, toolResults: McpToolCall[]): boolean =>
  stepHasSuccessfulRead(step) && (!requiresSuccessfulMutation(userGoal) || hasSuccessfulMutation(toolResults));

const LISTING_ACTIONS = new Set(["get_child_docs", "list_tree", "tree", "search_docs", "search"]);

const isInventoryIntent = (goal: string): boolean =>
  /文档|笔记|笔记本|目录|文件树|有哪些|列出|查看|看下|梳理|workspace|document|notebook|list|tree/i.test(runtimeUserIntent(goal));

const isToolHelpIntent = (goal: string): boolean =>
  /工具.*(用法|参数|schema|help)|MCP.*(用法|参数|schema|help)|怎么调用|如何调用/i.test(runtimeUserIntent(goal));

const isFinalizableListingAction = (action: ReActStep["actions"][number], userGoal: string): boolean => {
  if (!isInventoryIntent(userGoal)) return false;
  const args = parseArgumentSummary(action.argumentsSummary);
  if (isMutatingCall(args, action.toolName) || isHelpArgs(args)) return false;
  const actionName = typeof args.action === "string" ? args.action : "";
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (LISTING_ACTIONS.has(actionName)) return true;
  if (actionName === "ls" && path && path !== "/") return true;
  if (actionName === "list" && /笔记本|notebook/i.test(runtimeUserIntent(userGoal))) return true;
  return false;
};

const stepHasSuccessfulListing = (step: ReActStep, userGoal: string): boolean =>
  step.observations.some((observation) => observation.status === "success") &&
  step.actions.some((action) => isFinalizableListingAction(action, userGoal));

const shouldFinalizeAfterListing = (step: ReActStep, userGoal: string, toolResults: McpToolCall[]): boolean =>
  stepHasSuccessfulListing(step, userGoal) && (!requiresSuccessfulMutation(userGoal) || hasSuccessfulMutation(toolResults));

const hasSuccessfulListingResult = (toolResults: McpToolCall[], userGoal: string): boolean =>
  isInventoryIntent(userGoal) &&
  toolResults.some((result) => {
    if (result.status !== "success") return false;
    const args = parseArgumentSummary(result.argumentsSummary || "{}");
    const actionName = typeof args.action === "string" ? args.action : "";
    return actionName === "ls" || LISTING_ACTIONS.has(actionName);
  });

const preflightToolArgs = (
  tool: McpTool,
  args: Record<string, unknown>,
  options: { helpAlreadyObserved: boolean; userGoal: string },
): string | undefined => {
  const propertyNames = Object.keys((tool.inputSchema?.properties || {}) as Record<string, unknown>);
  const actions = actionValuesForTool(tool);
  if (options.helpAlreadyObserved && isHelpArgs(args)) {
    return `工具 ${tool.llmName} 的 help 已经返回过。不要重复 help；请基于已有 Observation，从 action enum 中选择具体动作：${actions.join(", ")}。用户目标：${options.userGoal}`;
  }
  if (actions.length > 0 && typeof args.action === "string" && !actions.includes(args.action)) {
    return `工具 ${tool.llmName} 的 action 必须从 enum 中选择，可选值：${actions.join(", ")}。当前 action=${args.action}`;
  }
  if (actions.length > 0 && typeof args.action !== "string") {
    return options.helpAlreadyObserved
      ? `工具 ${tool.llmName} 已经完成 help 探索，不能再使用空参数。请基于已有 Observation，从 action enum 中选择具体动作：${actions.join(", ")}。用户目标：${options.userGoal}`
      : `工具 ${tool.llmName} 需要先从 action enum 中选择 action，可选值：${actions.join(", ")}。不要使用空参数调用。`;
  }
  if (propertyNames.length > 0 && Object.keys(args).length === 0) {
    return `工具 ${tool.llmName} 不能使用空参数调用。请根据 input_schema 从这些字段中选择合适参数：${propertyNames.join(", ")}。`;
  }
  const required = Array.isArray(tool.inputSchema?.required)
    ? tool.inputSchema.required.filter((item): item is string => typeof item === "string")
    : [];
  const missing = required.filter((field) => args[field] === undefined);
  if (missing.length > 0) {
    return `工具 ${tool.llmName} 缺少必填参数：${missing.join(", ")}。`;
  }
  if (requiresSuccessfulMutation(options.userGoal)) {
    const mutationError = mutationContentError(args, options.userGoal);
    if (mutationError) return mutationError;
  }
  return undefined;
};

const shouldUseHelpForEmptyArgs = (
  tool: McpTool,
  args: Record<string, unknown>,
  helpedTools: Set<string>,
): boolean => Object.keys(args).length === 0 && actionValuesForTool(tool).includes("help") && !helpedTools.has(tool.llmName);

const suggestedInventoryArgs = (tool: McpTool, userGoal: string): Record<string, unknown> | undefined => {
  if (!isInventoryIntent(userGoal) || isToolHelpIntent(userGoal)) return undefined;
  const toolName = tool.llmName.toLowerCase();
  const actions = actionValuesForTool(tool).filter((action) => action !== "help");
  if (/_notebook\b|notebook/.test(toolName) && actions.includes("list")) return { action: "list" };
  if (/_fs\b|fs/.test(toolName)) {
    if (actions.includes("ls")) return { action: "ls", path: "/" };
    if (actions.includes("tree")) return { action: "tree", path: "/", maxDepth: 2 };
  }
  return undefined;
};

const normalizeInitialToolArgs = (
  tool: McpTool,
  args: Record<string, unknown>,
  helpedTools: Set<string>,
  userGoal: string,
): Record<string, unknown> => {
  const suggestion = suggestedInventoryArgs(tool, userGoal);
  if (suggestion && (Object.keys(args).length === 0 || isHelpArgs(args))) return suggestion;
  return shouldUseHelpForEmptyArgs(tool, args, helpedTools) ? { action: "help" } : args;
};

const rootListingChildPath = (summary: string): string | undefined => {
  const parsed = parseToolOutputJson(summary);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length !== 1) return undefined;
  const [item] = items;
  if (!item || typeof item !== "object") return undefined;
  const path = (item as { path?: unknown }).path;
  const children = (item as { children?: unknown }).children;
  return typeof path === "string" && path !== "/" && path.trim() && typeof children === "number" && children > 0
    ? path.trim()
    : undefined;
};

const repeatedRootListingArgs = (
  tool: McpTool,
  args: Record<string, unknown>,
  exactRecords: Map<string, ToolCallRecord>,
  workspaceVersion: number,
): Record<string, unknown> | undefined => {
  if (!/_fs\b|fs/i.test(tool.llmName)) return undefined;
  if (args.action !== "ls" || args.path !== "/") return undefined;
  const previous = exactRecords.get(toolCallSignature(tool, args));
  if (!previous || previous.status !== "success" || previous.workspaceVersion !== workspaceVersion) return undefined;
  const childPath = rootListingChildPath(previous.summary);
  return childPath ? { action: "ls", path: childPath } : undefined;
};

const latestUserGoal = (messages: ChatMessage[]): string =>
  [...messages]
    .reverse()
    .find((message) => message.role === "user" && !message.content.startsWith("ReAct 历史："))
    ?.content.trim() || "";

const parseJsonObject = (content: string): Record<string, unknown> | undefined => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || content;
  const direct = raw.trim();
  const candidates = [direct, direct.match(/\{[\s\S]*\}/)?.[0]].filter((item): item is string => Boolean(item));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
};

const repairToolArguments = async (
  profile: LlmProfile,
  tool: McpTool,
  userGoal: string,
  reactHistory: string[],
  signal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> => {
  const prompt: ChatMessage = {
    id: createId("msg"),
    role: "user",
    createdAt: nowIso(),
    status: "complete",
    content: [
      "上一轮已经完成工具 help/Observation，但主模型仍给出了空参数或重复 help。",
      "请根据用户目标、工具 input_schema、工具 description、以及 ReAct 历史，生成下一次真实工具调用的 JSON 参数。",
      "只输出 JSON object，不要输出解释、Markdown、代码块或自然语言。",
      "不要输出 {\"action\":\"help\"}，除非工具没有任何其它可用动作。",
      `用户目标：${userGoal}`,
      `工具名：${tool.llmName}`,
      `工具描述：${tool.description || tool.name}`,
      `input_schema：${summarizeJson(tool.inputSchema || {}, 2000)}`,
      reactHistory.slice(-3).join("\n\n"),
    ].join("\n"),
  };
  const result = await streamChatCompletion(profile, [prompt], {
    signal,
    tools: [],
    systemPrompt: "你是 ReAct Agent 的工具参数规划器。你的唯一任务是输出下一次工具调用参数的 JSON object。",
    onText: () => undefined,
  });
  const repaired = parseJsonObject(result.content);
  if (!repaired || Object.keys(repaired).length === 0 || isHelpArgs(repaired)) return undefined;
  return repaired;
};

const syntheticToolError = (tool: McpTool, args: Record<string, unknown>, message: string): McpToolCall => ({
  id: createId("tool"),
  serverId: tool.serverId,
  toolName: tool.name,
  llmName: tool.llmName,
  status: "error",
  startedAt: nowIso(),
  finishedAt: nowIso(),
  argumentsSummary: summarizeJson(args, 240),
  error: message,
});

const syntheticToolSkipped = (tool: McpTool, args: Record<string, unknown>, message: string): McpToolCall => ({
  id: createId("tool"),
  serverId: tool.serverId,
  toolName: tool.name,
  llmName: tool.llmName,
  status: "stopped",
  startedAt: nowIso(),
  finishedAt: nowIso(),
  argumentsSummary: summarizeJson(args, 240),
  error: message,
});

const finalAnswerFromHistory = async (
  profile: LlmProfile,
  runtimeMessages: ChatMessage[],
  signal: AbortSignal | undefined,
  reason: string,
): Promise<string> => {
  const prompt = syntheticHistoryMessage(
    [
      reason,
      "现在禁止继续调用工具。请只基于上面的对话与 ReAct 历史给出最终回答。",
      "如果上一轮对话或 Observation 已经出现明确 path，就说明应读取哪个文档或给出当前可判断的内容。",
      "注意：notebook.list 只能证明笔记本存在和打开状态，不能证明内容可读；fs.ls \"/\" 才代表当前 MCP 文件接口可读的笔记本根。遇到 permission_denied 必须说明受限，不要写成有访问权限。",
      "如果无法唯一确定，就直接说无法唯一确定，并列出最可能的候选路径；不要再次建议泛搜同一个关键词。",
    ].join("\n"),
  );
  const result = await streamChatCompletion(profile, [...runtimeMessages, prompt], {
    signal,
    tools: [],
    systemPrompt: "你是 ReAct Agent 的最终回答器。禁止调用工具，禁止输出工具调用，只能给用户一个简洁、可执行的最终回答。",
    onText: () => undefined,
  });
  return result.content.trim() || "已停止重复工具调用；当前信息不足以继续自动打开文档。";
};

export class AgentRuntime {
  async run(input: AgentRuntimeInput, handlers: AgentRuntimeHandlers): Promise<AgentRuntimeResult> {
    const mode = normalizeAgentMode(input.mode) || DEFAULT_AGENT_MODE;
    if (mode !== "react") {
      return this.runReact({ ...input, mode: "react" }, handlers);
    }
    return this.runReact(input, handlers);
  }

  private async runReact(input: AgentRuntimeInput, handlers: AgentRuntimeHandlers): Promise<AgentRuntimeResult> {
    const toolResults = [...(input.continuation?.toolResults || [])];
    const reactHistory = [...(input.continuation?.reactHistory || [])];
    const runtimeMessages = [...input.messages, ...reactHistory.map(syntheticHistoryMessage)];
    const userGoal = latestUserGoal(input.messages);
    const exactToolCallRecords = new Map<string, ToolCallRecord>();
    const searchIntentCounts = new Map<string, number>();
    const readIntentCounts = new Map<string, number>();
    let workspaceVersion = 0;
    const helpedTools = new Set(
      toolResults
        .filter((result) => result.status === "success" && result.argumentsSummary && /"action"\s*:\s*"help"/.test(result.argumentsSummary))
        .map((result) => result.llmName),
    );
    let completedRounds = input.continuation?.completedRounds || 0;
    let latest = await streamChatCompletion(input.profile, runtimeMessages, {
      signal: input.signal,
      tools: input.tools,
      toolResults: reactHistory.length === 0 && toolResults.length ? toolResults : undefined,
      onText: () => undefined,
    });

    for (let segmentRound = 0; segmentRound < REACT_SEGMENT_ROUNDS; segmentRound += 1) {
      const currentStepSignatures = new Set<string>();
      completedRounds += 1;
      const step: ReActStep = {
        id: createId("react"),
        round: completedRounds,
        thought: thoughtFromResult(latest, latest.toolRequests.length > 0, toolResults.length > 0 || reactHistory.length > 0),
        actions: [],
        observations: [],
        status: "running",
      };

      if (latest.toolRequests.length === 0) {
        if (requiresSuccessfulMutation(userGoal) && !hasSuccessfulMutation(toolResults)) {
          runtimeMessages.push(
            syntheticHistoryMessage(
              [
                "执行约束未满足：用户选择了 skill，并且目标包含记录/写入意图，但当前还没有任何成功的 MCP 写入类调用。",
                "不能直接说“已记录”或“已保存”。必须继续通过 MCP 工具完成实际写入。",
                "优先使用 fs.write / fs.replace / create 等可用写入动作；如果无法确定写入路径，先通过 MCP 读取 skill 或目录结构，再写入合适位置；如果工具无法写入，明确说明失败原因。",
              ].join("\n"),
            ),
          );
          latest = await streamChatCompletion(input.profile, runtimeMessages, {
            signal: input.signal,
            tools: input.tools,
            onText: () => undefined,
          });
          continue;
        }
        const content = finalizeAgentContent(latest.content, toolResults);
        handlers.onStep({ ...step, status: "complete" });
        handlers.onText(content);
        return { status: "final", content, toolResults, completedRounds, reactHistory };
      }

      for (const request of latest.toolRequests) {
        const tool = input.tools.find((candidate) => candidate.llmName === request.name);
        if (!tool) continue;
        let effectiveArguments = normalizeInitialToolArgs(tool, request.arguments, helpedTools, userGoal);
        effectiveArguments =
          repeatedRootListingArgs(tool, effectiveArguments, exactToolCallRecords, workspaceVersion) || effectiveArguments;
        const needsArgumentRepair =
          helpedTools.has(tool.llmName) && (Object.keys(effectiveArguments).length === 0 || isHelpArgs(effectiveArguments));
        if (needsArgumentRepair) {
          const repaired = await repairToolArguments(input.profile, tool, userGoal, reactHistory, input.signal);
          if (repaired) {
            effectiveArguments = repaired;
          }
        }
        const argsSummary = summarizeJson(effectiveArguments, 240);
        const pending = handlers.onToolStart(tool, effectiveArguments, request.id);
        step.actions.push({
          toolName: tool.llmName,
          argumentsSummary: argsSummary,
        });
        const guardError = toolGuardReason(
          tool,
          effectiveArguments,
          exactToolCallRecords,
          currentStepSignatures,
          searchIntentCounts,
          readIntentCounts,
          workspaceVersion,
        );
        rememberToolCallAttempt(tool, effectiveArguments, currentStepSignatures, searchIntentCounts, readIntentCounts);
        const preflightError = guardError || preflightToolArgs(tool, effectiveArguments, {
          helpAlreadyObserved: helpedTools.has(tool.llmName),
          userGoal,
        });
        const result = preflightError
          ? preflightError.startsWith(DUPLICATE_GUARD_PREFIX)
            ? syntheticToolSkipped(tool, effectiveArguments, preflightError)
            : syntheticToolError(tool, effectiveArguments, preflightError)
          : await handlers.callTool(tool, effectiveArguments);
        const finalResult = { ...result, id: pending.id };
        if (finalResult.status === "success" && isMutatingCall(effectiveArguments, tool.llmName || tool.name)) {
          workspaceVersion += 1;
        }
        rememberToolCallResult(tool, effectiveArguments, finalResult, exactToolCallRecords, workspaceVersion);
        toolResults.push(finalResult);
        if (finalResult.status === "success" && isHelpArgs(effectiveArguments)) {
          helpedTools.add(tool.llmName);
        }
        handlers.onToolFinish(finalResult);
        step.observations.push({
          status: finalResult.status,
          summary: observationSummary(finalResult),
        });
      }

      if (step.thought === "判断需要调用工具获取信息。") {
        step.thought = actionThought(step);
      }
      handlers.onStep({ ...step, status: step.observations.some((item) => item.status === "error") ? "error" : "complete" });
      const historyEntry = formatReActHistoryEntry(step);
      reactHistory.push(historyEntry);
      runtimeMessages.push(syntheticHistoryMessage(historyEntry));

      if (stepHitRepeatGuard(step)) {
        const guardReason =
          step.observations.find((observation) => observation.summary.startsWith(REPEAT_GUARD_PREFIX))?.summary ||
          "检测到重复工具调用。";
        const content = finalizeAgentContent(await finalAnswerFromHistory(input.profile, runtimeMessages, input.signal, guardReason), toolResults);
        handlers.onText(content);
        return { status: "final", content, toolResults, completedRounds, reactHistory };
      }

      if (stepHitDuplicateGuard(step) && hasSuccessfulListingResult(toolResults, userGoal)) {
        const content = finalizeAgentContent(
          await finalAnswerFromHistory(
            input.profile,
            runtimeMessages,
            input.signal,
            "检测到模型正在重复调用已经成功的目录枚举工具。现在必须停止继续调用工具，基于已有 Observation 总结当前可见的文档结构和访问受限项。",
          ),
          toolResults,
        );
        handlers.onText(content);
        return { status: "final", content, toolResults, completedRounds, reactHistory };
      }

      if (requiresSuccessfulMutation(userGoal) && stepHasSuccessfulMutation(step)) {
        const content = finalizeAgentContent(
          await finalAnswerFromHistory(
            input.profile,
            runtimeMessages,
            input.signal,
            "已经观察到成功的 MCP 写入类调用。现在必须停止继续写入或查询，只基于写入结果给用户确认保存位置和保存内容摘要。插件会在最终回答末尾自动追加完整的实际变更清单，因此正文不要遗漏或编造变更。",
          ),
          toolResults,
        );
        handlers.onText(content);
        return { status: "final", content, toolResults, completedRounds, reactHistory };
      }

      if (shouldFinalizeAfterRead(step, userGoal, toolResults)) {
        const content = finalizeAgentContent(
          await finalAnswerFromHistory(
            input.profile,
            runtimeMessages,
            input.signal,
            "已经成功读取到用户要求查看的文档内容。现在应基于已读内容直接回答，不要继续调用工具。",
          ),
          toolResults,
        );
        handlers.onText(content);
        return { status: "final", content, toolResults, completedRounds, reactHistory };
      }

      if (shouldFinalizeAfterListing(step, userGoal, toolResults)) {
        const content = finalizeAgentContent(
          await finalAnswerFromHistory(
            input.profile,
            runtimeMessages,
            input.signal,
            "已经成功拿到用户要求的文档列表、目录树或文档候选。现在应基于已有 Observation 总结当前可见的文档范围、关键路径和访问受限项，不要继续调用工具。",
          ),
          toolResults,
        );
        handlers.onText(content);
        return { status: "final", content, toolResults, completedRounds, reactHistory };
      }

      if (segmentRound === REACT_SEGMENT_ROUNDS - 1) {
        const content = finalizeAgentContent(
          await finalAnswerFromHistory(
            input.profile,
            runtimeMessages,
            input.signal,
            "已经达到默认思考轮次上限。现在必须根据已有 Observation 给出当前最完整回答，说明已完成、受限和无法继续确认的部分，不要再要求用户点击继续。",
          ),
          toolResults,
        );
        handlers.onText(content);
        return { status: "final", content, toolResults, completedRounds, reactHistory };
      }

      latest = await streamChatCompletion(input.profile, runtimeMessages, {
        signal: input.signal,
        tools: input.tools,
        onText: () => undefined,
      });
    }

    const content = finalizeAgentContent(
      await finalAnswerFromHistory(
        input.profile,
        runtimeMessages,
        input.signal,
        "已经达到默认思考轮次上限。现在必须根据已有 Observation 给出当前最完整回答，说明已完成、受限和无法继续确认的部分，不要再要求用户点击继续。",
      ),
      toolResults,
    );
    handlers.onText(content);
    return { status: "final", content, toolResults, completedRounds, reactHistory };
  }
}
