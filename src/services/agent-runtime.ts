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
  return [
    "ReAct 历史：",
    `第 ${step.round} 轮`,
    `Thought：${step.thought}`,
    `Action：${actions}`,
    `Observation：${observations}`,
    "下一步必须基于上述 Observation 继续推理；不要忽略已经返回的工具结果。",
    usedHelp ? "注意：help 已经返回工具用法，下一轮不要重复 help；请改用具体 action 和必填参数，或在信息足够时给出最终回答。" : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const actionValuesForTool = (tool: McpTool): string[] => {
  const action = ((tool.inputSchema?.properties || {}) as Record<string, unknown>).action as { enum?: unknown[] } | undefined;
  return Array.isArray(action?.enum) ? action.enum.filter((item): item is string => typeof item === "string") : [];
};

const isHelpArgs = (args: Record<string, unknown>): boolean => args.action === "help";

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
  return undefined;
};

const shouldUseHelpForEmptyArgs = (
  tool: McpTool,
  args: Record<string, unknown>,
  helpedTools: Set<string>,
): boolean => Object.keys(args).length === 0 && actionValuesForTool(tool).includes("help") && !helpedTools.has(tool.llmName);

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
        handlers.onStep({ ...step, status: "complete" });
        handlers.onText(latest.content);
        return { status: "final", content: latest.content, toolResults, completedRounds, reactHistory };
      }

      for (const request of latest.toolRequests) {
        const tool = input.tools.find((candidate) => candidate.llmName === request.name);
        if (!tool) continue;
        let effectiveArguments = shouldUseHelpForEmptyArgs(tool, request.arguments, helpedTools)
          ? { action: "help" }
          : request.arguments;
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
        const preflightError = preflightToolArgs(tool, effectiveArguments, {
          helpAlreadyObserved: helpedTools.has(tool.llmName),
          userGoal,
        });
        const result = preflightError
          ? syntheticToolError(tool, effectiveArguments, preflightError)
          : await handlers.callTool(tool, effectiveArguments);
        const finalResult = { ...result, id: pending.id };
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

      if (segmentRound === REACT_SEGMENT_ROUNDS - 1) {
        return {
          status: "paused",
          content: latest.content,
          toolResults,
          completedRounds,
          reactHistory,
          pauseReason: REACT_PAUSE_MESSAGE,
        };
      }

      latest = await streamChatCompletion(input.profile, runtimeMessages, {
        signal: input.signal,
        tools: input.tools,
        onText: () => undefined,
      });
    }

    return {
      status: "paused",
      content: latest.content,
      toolResults,
      completedRounds,
      reactHistory,
      pauseReason: REACT_PAUSE_MESSAGE,
    };
  }
}
