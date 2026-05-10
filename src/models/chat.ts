import type { McpToolCall } from "./mcp";
import type { AgentMode, ReActContinuationState, ReActTrace } from "./agent";

export type ChatRole = "user" | "assistant" | "tool-status";
export type ChatMessageStatus = "pending" | "streaming" | "complete" | "error" | "stopped" | "waiting-continue";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status: ChatMessageStatus;
  toolCallId?: string;
  reactTrace?: ReActTrace;
  pauseHint?: string;
}

export interface ChatSession {
  messages: ChatMessage[];
  toolCalls: McpToolCall[];
  isGenerating: boolean;
  generationId?: string;
  agentMode: AgentMode;
  continuation?: ReActContinuationState;
}

export type ChatListener = (session: ChatSession) => void;
