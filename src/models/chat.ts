import type { McpToolCall } from "./mcp";

export type ChatRole = "user" | "assistant" | "tool-status";
export type ChatMessageStatus = "pending" | "streaming" | "complete" | "error" | "stopped";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status: ChatMessageStatus;
  toolCallId?: string;
}

export interface ChatSession {
  messages: ChatMessage[];
  toolCalls: McpToolCall[];
  isGenerating: boolean;
  generationId?: string;
}

export type ChatListener = (session: ChatSession) => void;
