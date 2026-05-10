import type { LlmProfile } from "../models/llm";
import type { ChatMessage } from "../models/chat";
import type { McpTool, McpToolCall } from "../models/mcp";
import { DEEPSEEK_BASE_URL } from "../models/llm";
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

export interface LlmToolRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmStreamHandlers {
  signal?: AbortSignal;
  tools?: McpTool[];
  toolResults?: McpToolCall[];
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

const toWireMessages = (messages: ChatMessage[], toolResults: McpToolCall[] = []): LlmWireMessage[] => {
  const wire: LlmWireMessage[] = [
    {
      role: "system",
      content:
        "你是思源笔记里的个人 AI 助手。当前版本不能读取思源文档上下文。可以根据需要自动调用已启用的 MCP 工具。",
    },
  ];
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
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

const toLlmTools = (tools: McpTool[]) =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.llmName,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
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

export const streamChatCompletion = async (
  profile: LlmProfile,
  messages: ChatMessage[],
  handlers: LlmStreamHandlers,
): Promise<LlmStreamResult> => {
  throwIfAborted(handlers.signal);
  const response = await fetch(endpointForProfile(profile), {
    method: "POST",
    signal: handlers.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${profile.apiKey}`,
    },
    body: JSON.stringify({
      model: profile.model,
      messages: toWireMessages(messages, handlers.toolResults || []),
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
          handlers.onText(delta.content);
        }
        collectToolDelta(toolCalls, delta);
      }
    }
  } finally {
    handlers.signal?.removeEventListener("abort", cancelReader);
  }

  return {
    content,
    toolRequests: toolCalls
      .filter((call) => call.function.name)
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: parseToolArgs(call.function.arguments),
      })),
  };
};
