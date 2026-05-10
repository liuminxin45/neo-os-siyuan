export type McpTransportType = "stdio" | "sse" | "streamable-http";
export type McpServerStatus = "idle" | "validating" | "ready" | "error";
export type McpToolCallStatus = "pending" | "running" | "success" | "error" | "stopped";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportType;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  status: McpServerStatus;
  lastError?: string;
  updatedAt: string;
}

export interface McpTool {
  serverId: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  llmName: string;
}

export interface McpToolCall {
  id: string;
  serverId: string;
  toolName: string;
  llmName: string;
  status: McpToolCallStatus;
  startedAt: string;
  finishedAt?: string;
  argumentsSummary?: string;
  outputSummary?: string;
  error?: string;
}

export interface McpServerDraft {
  id?: string;
  name: string;
  transport: McpTransportType;
  enabled: boolean;
  command?: string;
  argsText?: string;
  envText?: string;
  url?: string;
}
