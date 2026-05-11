import type { McpToolCall } from "./mcp";
import type { AgentMode, ReActContinuationState, ReActTrace } from "./agent";

export type ChatRole = "user" | "assistant" | "tool-status";
export type ChatMessageStatus = "pending" | "streaming" | "complete" | "error" | "stopped" | "waiting-continue";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  runtimeContent?: string;
  createdAt: string;
  status: ChatMessageStatus;
  toolCallId?: string;
  references?: ChatReference[];
  reactTrace?: ReActTrace;
  pauseHint?: string;
}

export interface ChatReference {
  title: string;
  path: string;
  sourceLabel?: string;
}

export interface ChatArchiveSummary {
  conversationId: string;
  fileName: string;
  path: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface ChatSession {
  conversationId: string;
  messages: ChatMessage[];
  toolCalls: McpToolCall[];
  isGenerating: boolean;
  generationId?: string;
  agentMode: AgentMode;
  continuation?: ReActContinuationState;
  archives: ChatArchiveSummary[];
  archiveStatus: "idle" | "loading" | "ready" | "saving" | "error";
  archiveError?: string;
}

export type ChatListener = (session: ChatSession) => void;
