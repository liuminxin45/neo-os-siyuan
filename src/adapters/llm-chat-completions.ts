import type { LlmProfile } from "../models/llm";
import type { ChatMessage } from "../models/chat";
import type { McpTool, McpToolCall } from "../models/mcp";
import { DEEPSEEK_BASE_URL, KIMI_CODING_BASE_URL } from "../models/llm";
import { normalizeBaseUrl } from "../utils/text";

interface LlmWireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: LlmToolCall[];
}

interface LlmToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface AnthropicToolCall {
  id: string;
  name: string;
  inputJson: string;
}

export interface LlmToolRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmStreamHandlers {
  signal?: AbortSignal;
  tools?: McpTool[];
  toolResults?: McpToolCall[];
  systemPrompt?: string;
  onText: (chunk: string) => void;
}

export interface LlmStreamResult {
  content: string;
  toolRequests: LlmToolRequest[];
}

const endpointForProfile = (profile: LlmProfile): string => {
  const baseUrl = profile.provider === "deepseek" ? DEEPSEEK_BASE_URL : profile.baseUrl || "";
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
};

const anthropicEndpointForProfile = (profile: LlmProfile): string => {
  const baseUrl = profile.provider === "kimi-coding-plan" ? KIMI_CODING_BASE_URL : profile.baseUrl || "";
  const trimmed = normalizeBaseUrl(baseUrl);
  if (/\/v\d+\/messages$/i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
};

const toWireMessages = (
  messages: ChatMessage[],
  toolResults: McpToolCall[] = [],
  tools: McpTool[] = [],
  systemPrompt?: string,
): LlmWireMessage[] => {
  if (systemPrompt) {
    const wire: LlmWireMessage[] = [{ role: "system", content: systemPrompt }];
    for (const message of messages) {
      if (message.role === "user" || message.role === "assistant") {
        const content = message.content.trim();
        if (message.role === "assistant" && !content) continue;
        wire.push({ role: message.role, content: message.content });
      }
    }
    return wire;
  }
  const toolNames = tools.map((tool) => tool.llmName).join(", ");
  const toolContracts = tools
    .map((tool) => {
      const properties = (tool.inputSchema?.properties || {}) as Record<string, unknown>;
      const propertyNames = Object.keys(properties).slice(0, 18);
      const action = properties.action as { enum?: unknown[] } | undefined;
      const actions = Array.isArray(action?.enum) ? action.enum.filter((item): item is string => typeof item === "string") : [];
      return `${tool.llmName}: properties=[${propertyNames.join(", ")}]${actions.length ? ` actions=[${actions.join(", ")}]` : ""}`;
    })
    .join("\n");
  const skillInstruction =
    "当用户消息包含“已选 skill”时，插件只提供了 skill 名称、简述和索引路径。你必须先理解用户真实目标；目标不清楚时先追问。需要读取完整 skill、访问 LLM-Wiki/runs、读取或写入任何思源工作区内容时，必须通过 MCP 工具完成，不要假设插件已经读取过这些内容。只有 Observation 中出现成功的 MCP 写入类调用后，才可以说已经记录、保存或写入。";
  const mutationLedgerInstruction =
    "如果你执行过任何成功的写入、编辑、删除、移动、创建、重命名或属性更新类 MCP 调用，最终回答必须清楚说明实际发生的变更；插件运行时还会根据工具结果自动追加固定格式的“实际变更清单”，你不得编造未发生的变更。";
  const documentLinkInstruction =
    "当你已经通过 MCP 找到或引用了 LLM-Wiki 中的文档时，最终回答应尽量使用可点击文档引用格式：已知标题时写 [[文档标题]]，已知路径时写 [文档标题](wiki/...) 或 [文档标题](/LLM-Wiki/wiki/...)。只链接真实找到的文档，不要为未验证文档编造链接。";
  const toolHint = toolNames
    ? `当前可调用的 MCP tools.name：${toolNames}。\n可用工具契约摘要：\n${toolContracts}\n本插件主要用于思源笔记工作区，用户即使没有明确说“使用 MCP”，只要问题涉及笔记本、文档、块、数据库、标签、文件、搜索、当前工作区内容、笔记内容或需要查询/读取/遍历/统计思源里的信息，就应优先查看可用工具的 description 和 input_schema，自主选择合适 MCP 工具并用结构化工具调用协议执行。${skillInstruction}${mutationLedgerInstruction}${documentLinkInstruction}调用工具前必须检查 input_schema，尤其是 action enum 和必填字段；不要用空参数调用需要 action 或查询参数的工具。每轮调用后必须阅读 ReAct 历史里的 Observation 并基于结果继续；如果上一轮 help 已返回用法，下一轮不要重复 help，要选择具体 action 和参数。如果用户说“这篇”“那篇”“上一篇”等指代，而前文或 Observation 已经出现明确 path，应优先 read 该 path，不要重新泛搜关键词。只有纯常识、写作、解释或无需工作区数据的问题才直接回答。不要在正文中输出 XML、伪标签或未出现在 tools.name 中的工具名。`
    : "当前没有可调用的 MCP tools；如果用户请求涉及思源工作区数据，应明确说明没有可用 MCP 工具，不要在正文中伪造工具调用标签。";
  const wire: LlmWireMessage[] = [
    {
      role: "system",
      content: `你是思源笔记里的个人 AI 助手。你应主动判断用户意图，并在需要查询、读取或操作思源工作区数据时优先使用 MCP 工具。${toolHint}`,
    },
  ];
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      const content = message.content.trim();
      if (message.role === "assistant" && !content) continue;
      wire.push({ role: message.role, content: message.content });
    }
  }
  for (const result of toolResults) {
    wire.push({
      role: "user",
      content: `MCP 工具 ${result.toolName} 调用结果：${
        result.status === "success" ? result.outputSummary || "工具调用成功" : result.error || result.status
      }`,
    });
  }
  return wire;
};

const toAnthropicWireMessages = (
  messages: ChatMessage[],
  toolResults: McpToolCall[] = [],
  tools: McpTool[] = [],
  systemPrompt?: string,
): LlmWireMessage[] => {
  const wire = toWireMessages(messages, toolResults, tools, systemPrompt);
  if (systemPrompt) return wire;
  const system = wire[0];
  if (system?.role === "system") {
    const toolNames = tools.map((tool) => tool.llmName).join(", ");
    const toolHint = toolNames
      ? `\n当前可用 MCP 工具名必须完全按 tools.name 使用：${toolNames}。请根据每个工具的 description 和 input_schema 自行判断用户意图、选择工具与参数。用户没有明确说 MCP 时，只要问题需要思源工作区数据，也要优先调用合适工具。成功执行任何写入、编辑、删除、移动、创建、重命名或属性更新类调用后，最终回答必须说明实际变更；插件会自动追加固定格式的“实际变更清单”。如果已经找到或引用 LLM-Wiki 文档，最终回答应使用 [[文档标题]] 或 [文档标题](wiki/...) 形式，让插件渲染为可点击入口。调用前必须检查 action enum 和必填字段，不要用空参数调用需要 action 或查询参数的工具。每轮调用后必须阅读 ReAct 历史里的 Observation 并基于结果继续；如果上一轮 help 已返回用法，下一轮不要重复 help，要选择具体 action 和参数。如果用户说“这篇”“那篇”“上一篇”等指代，而前文或 Observation 已经出现明确 path，应优先 read 该 path，不要重新泛搜关键词。不要编造未出现在 tools.name 中的工具名。`
      : "";
    system.content = `${system.content}\nKimi CodingPlan 必须使用 Anthropic Messages 的结构化 tools/tool_use 协议调用工具。不要在正文中输出 <function_calls>、<invoke> 或 <antThinking> 标签。${toolHint}`;
  }
  return wire;
};

const toLlmTools = (tools: McpTool[]) =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.llmName,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
  }));

const toAnthropicTools = (tools: McpTool[]) =>
  tools.map((tool) => ({
    name: tool.llmName,
    description: tool.description || tool.name,
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  }));

const parseToolArgs = (value: string): Record<string, unknown> => {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const collectToolDelta = (toolCalls: LlmToolCall[], delta: any): void => {
  if (!Array.isArray(delta?.tool_calls)) return;
  for (const toolDelta of delta.tool_calls) {
    const index = toolDelta.index ?? 0;
    toolCalls[index] ||= {
      id: toolDelta.id || `tool_${index}`,
      type: "function",
      function: { name: "", arguments: "" },
    };
    if (toolDelta.id) toolCalls[index].id = toolDelta.id;
    if (toolDelta.function?.name) toolCalls[index].function.name += toolDelta.function.name;
    if (toolDelta.function?.arguments) toolCalls[index].function.arguments += toolDelta.function.arguments;
  }
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  const error = new Error("LLM 请求已停止");
  error.name = "AbortError";
  throw error;
};

const collectAnthropicToolEvent = (toolCalls: AnthropicToolCall[], event: any): void => {
  const index = event.index ?? 0;
  if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
    toolCalls[index] = {
      id: event.content_block.id || `tool_${index}`,
      name: event.content_block.name || "",
      inputJson: event.content_block.input ? JSON.stringify(event.content_block.input) : "",
    };
    return;
  }
  if (event.type !== "content_block_delta" || event.delta?.type !== "input_json_delta") return;
  toolCalls[index] ||= { id: `tool_${index}`, name: "", inputJson: "" };
  toolCalls[index].inputJson += event.delta.partial_json || "";
};

const xmlDecode = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const resolveLegacyToolCall = (
  rawName: string,
  rawArgs: Record<string, unknown>,
  tools: McpTool[],
): { name: string; arguments: Record<string, unknown> } => {
  const exact = tools.find((tool) => tool.llmName === rawName);
  if (exact) return { name: exact.llmName, arguments: rawArgs };

  const sameName = tools.filter((tool) => tool.name === rawName);
  if (sameName.length === 1) {
    return { name: sameName[0].llmName, arguments: rawArgs };
  }

  return { name: rawName, arguments: rawArgs };
};

const wordTokens = (value: string): string[] =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
    .map((token) => (token.endsWith("s") ? token.slice(0, -1) : token));

const actionValuesForTool = (tool: McpTool): string[] => {
  const action = (tool.inputSchema?.properties as Record<string, unknown> | undefined)?.action as
    | { enum?: unknown[] }
    | undefined;
  return Array.isArray(action?.enum) ? action.enum.filter((value): value is string => typeof value === "string") : [];
};

const normalizeAction = (value: string): string => wordTokens(value).join("");

const resolveSchemaInferredToolCall = (
  rawName: string,
  rawArgs: Record<string, unknown>,
  tools: McpTool[],
): { name: string; arguments: Record<string, unknown> } | undefined => {
  const rawTokens = wordTokens(rawName);
  const candidates = tools.filter((tool) => rawTokens.includes(wordTokens(tool.name)[0] || ""));
  if (candidates.length !== 1) return undefined;

  const actionValues = actionValuesForTool(candidates[0]);
  if (!actionValues.length) return { name: candidates[0].llmName, arguments: rawArgs };
  const actionText = typeof rawArgs.action === "string" ? `${rawName} ${rawArgs.action}` : rawName;
  const normalizedAction = normalizeAction(actionText);
  const action = actionValues.find((value) => normalizeAction(value) === normalizedAction || normalizedAction.includes(normalizeAction(value)));
  if (!action) return undefined;

  return {
    name: candidates[0].llmName,
    arguments: { ...rawArgs, action },
  };
};

const parseLegacyKimiToolCalls = (content: string, tools: McpTool[] = []): LlmToolRequest[] => {
  const block = content.match(/<function_calls>([\s\S]*?)<\/function_calls>/i)?.[1];
  if (!block) return [];
  const requests: LlmToolRequest[] = [];
  const invokePattern = /<invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/gi;
  let invoke: RegExpExecArray | null;
  while ((invoke = invokePattern.exec(block))) {
    const args: Record<string, unknown> = {};
    const paramPattern = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
    let param: RegExpExecArray | null;
    while ((param = paramPattern.exec(invoke[2]))) {
      const rawValue = xmlDecode(param[2].trim());
      try {
        args[param[1]] = JSON.parse(rawValue);
      } catch {
        args[param[1]] = rawValue;
      }
    }
    const resolved = resolveLegacyToolCall(invoke[1], args, tools);
    requests.push({ id: `tool_${requests.length}`, name: resolved.name, arguments: resolved.arguments });
  }
  return requests;
};

const parseXmlJsonToolCalls = (content: string, tools: McpTool[] = []): LlmToolRequest[] => {
  const requests: LlmToolRequest[] = [];
  const tagPattern = /<([a-zA-Z][\w:-]*)>\s*(\{[\s\S]*?\})\s*<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(content))) {
    const rawName = match[1];
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(match[2]) as Record<string, unknown>;
    } catch {
      continue;
    }
    const direct = resolveLegacyToolCall(rawName, args, tools);
    const resolved =
      direct.name === rawName ? resolveSchemaInferredToolCall(rawName, args, tools) || direct : direct;
    if (tools.some((tool) => tool.llmName === resolved.name)) {
      requests.push({ id: `tool_${requests.length}`, name: resolved.name, arguments: resolved.arguments });
    }
  }
  return requests;
};

const stripLegacyKimiToolMarkup = (content: string): string =>
  content
    .replace(/<antThinking>[\s\S]*?<\/antThinking>/gi, "")
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "")
    .replace(/<([a-zA-Z][\w:-]*)>\s*\{[\s\S]*?\}\s*<\/\1>/g, "")
    .trim();

const streamAnthropicMessages = async (
  profile: LlmProfile,
  messages: ChatMessage[],
  handlers: LlmStreamHandlers,
): Promise<LlmStreamResult> => {
  throwIfAborted(handlers.signal);
  const wireMessages = toAnthropicWireMessages(messages, handlers.toolResults || [], handlers.tools || [], handlers.systemPrompt);
  const system = wireMessages
    .filter((message) => message.role === "system")
    .map((message) => message.content || "")
    .join("\n\n");
  const conversation = wireMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content || "" }));
  const response = await fetch(anthropicEndpointForProfile(profile), {
    method: "POST",
    signal: handlers.signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": profile.apiKey || "",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: profile.model,
      system: system || undefined,
      messages: conversation,
      stream: true,
      max_tokens: 4096,
      tools: handlers.tools?.length ? toAnthropicTools(handlers.tools) : undefined,
      tool_choice: handlers.tools?.length ? { type: "auto" } : undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`Kimi CodingPlan 请求失败：${response.status} ${response.statusText}`);
  }
  if (!response.body) throw new Error("Kimi CodingPlan 响应没有可读取的数据流");

  const reader = response.body.getReader();
  const cancelReader = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  handlers.signal?.addEventListener("abort", cancelReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCalls: AnthropicToolCall[] = [];

  try {
    while (true) {
      throwIfAborted(handlers.signal);
      const { value, done } = await reader.read();
      throwIfAborted(handlers.signal);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const parsed = JSON.parse(data);
        const text = parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" ? parsed.delta.text : "";
        if (text) {
          content += text;
        }
        collectAnthropicToolEvent(toolCalls, parsed);
      }
    }
  } finally {
    handlers.signal?.removeEventListener("abort", cancelReader);
  }

  const visibleContent = stripLegacyKimiToolMarkup(content);
  if (visibleContent) handlers.onText(visibleContent);

  return {
    content: visibleContent,
    toolRequests: [
      ...toolCalls
      .filter((call) => call.name)
      .map((call) => ({
        id: call.id,
        name: call.name,
        arguments: parseToolArgs(call.inputJson),
      })),
      ...parseLegacyKimiToolCalls(content, handlers.tools || []),
      ...parseXmlJsonToolCalls(content, handlers.tools || []),
    ],
  };
};

export const streamChatCompletion = async (
  profile: LlmProfile,
  messages: ChatMessage[],
  handlers: LlmStreamHandlers,
): Promise<LlmStreamResult> => {
  if (profile.provider === "kimi-coding-plan") {
    return streamAnthropicMessages(profile, messages, handlers);
  }
  throwIfAborted(handlers.signal);
  const response = await fetch(endpointForProfile(profile), {
    method: "POST",
    signal: handlers.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${profile.apiKey || ""}`,
    },
    body: JSON.stringify({
      model: profile.model,
      messages: toWireMessages(messages, handlers.toolResults || [], handlers.tools || [], handlers.systemPrompt),
      stream: true,
      tools: handlers.tools?.length ? toLlmTools(handlers.tools) : undefined,
      tool_choice: handlers.tools?.length ? "auto" : undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM 请求失败：${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("LLM 响应没有可读取的数据流");
  }

  const reader = response.body.getReader();
  const cancelReader = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  handlers.signal?.addEventListener("abort", cancelReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCalls: LlmToolCall[] = [];

  try {
    while (true) {
      throwIfAborted(handlers.signal);
      const { value, done } = await reader.read();
      throwIfAborted(handlers.signal);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        throwIfAborted(handlers.signal);
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
        }
        collectToolDelta(toolCalls, delta);
      }
    }
  } finally {
    handlers.signal?.removeEventListener("abort", cancelReader);
  }

  const visibleContent = stripLegacyKimiToolMarkup(content);
  if (visibleContent) handlers.onText(visibleContent);

  return {
    content: visibleContent,
    toolRequests: [
      ...toolCalls
        .filter((call) => call.function.name)
        .map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: parseToolArgs(call.function.arguments),
        })),
      ...parseXmlJsonToolCalls(content, handlers.tools || []),
    ],
  };
};
