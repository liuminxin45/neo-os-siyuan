import type { McpServerConfig, McpServerDraft, McpTool, McpToolCall } from "../models/mcp";
import { createId, nowIso } from "../utils/ids";
import { isHttpUrl } from "../utils/text";
import { safeErrorText, summarizeJson } from "../utils/masks";
import { connectMcpServer, type ConnectedMcpServer } from "../adapters/mcp-transports";

export interface McpValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

export const validateMcpServer = (draft: McpServerDraft): McpValidationResult => {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "请输入 MCP 名称";
  if (draft.transport === "stdio" && !draft.command?.trim()) {
    errors.command = "请输入启动命令";
  }
  if ((draft.transport === "sse" || draft.transport === "streamable-http") && !draft.url?.trim()) {
    errors.url = "请输入 URL";
  }
  if (draft.url && !isHttpUrl(draft.url)) {
    errors.url = "URL 必须是 http 或 https 地址";
  }
  return { ok: Object.keys(errors).length === 0, errors };
};

export const parseArgs = (argsText?: string): string[] =>
  (argsText || "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

export const parseEnv = (envText?: string): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const line of (envText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
};

export const materializeMcpServer = (draft: McpServerDraft, existing?: McpServerConfig): McpServerConfig => ({
  id: existing?.id || draft.id || createId("mcp"),
  name: draft.name.trim(),
  transport: draft.transport,
  enabled: draft.enabled,
  command: draft.transport === "stdio" ? draft.command?.trim() : undefined,
  args: draft.transport === "stdio" ? parseArgs(draft.argsText) : undefined,
  env: draft.transport === "stdio" ? parseEnv(draft.envText) : undefined,
  url: draft.transport === "stdio" ? undefined : draft.url?.trim(),
  status: existing?.status || "idle",
  lastError: undefined,
  updatedAt: nowIso(),
});

export const cloneServerToDraft = (server: McpServerConfig): McpServerDraft => ({
  id: server.id,
  name: server.name,
  transport: server.transport,
  enabled: server.enabled,
  command: server.command,
  argsText: (server.args || []).join("\n"),
  envText: Object.entries(server.env || {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n"),
  url: server.url,
});

const createLlmToolName = (server: McpServerConfig, toolName: string): string =>
  `${server.name}_${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

const isMcpErrorResult = (result: unknown): boolean =>
  typeof result === "object" && result !== null && (result as { isError?: unknown }).isError === true;

export class McpService {
  private connections = new Map<string, ConnectedMcpServer>();
  private tools = new Map<string, McpTool[]>();

  getTools(): McpTool[] {
    return [...this.tools.values()].flat();
  }

  async discover(server: McpServerConfig): Promise<{ server: McpServerConfig; tools: McpTool[] }> {
    const nextServer: McpServerConfig = { ...server, status: "validating", lastError: undefined };
    try {
      const connection = await connectMcpServer(server);
      const rawTools = await connection.listTools();
      const tools = rawTools.map((tool) => ({
        serverId: server.id,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        llmName: createLlmToolName(server, tool.name),
      }));
      this.connections.set(server.id, connection);
      this.tools.set(server.id, tools);
      return { server: { ...nextServer, status: "ready", updatedAt: nowIso() }, tools };
    } catch (error) {
      return {
        server: { ...nextServer, status: "error", lastError: safeErrorText(error), updatedAt: nowIso() },
        tools: [],
      };
    }
  }

  async callTool(tool: McpTool, args: Record<string, unknown>, generationId: string): Promise<McpToolCall> {
    const call: McpToolCall = {
      id: createId("tool"),
      serverId: tool.serverId,
      toolName: tool.name,
      llmName: tool.llmName,
      status: "running",
      startedAt: nowIso(),
      argumentsSummary: summarizeJson(args, 240),
    };
    try {
      const connection = this.connections.get(tool.serverId);
      if (!connection) throw new Error("MCP 未连接");
      const result = await connection.callTool(tool.name, args);
      if (generationId.endsWith(":stopped")) {
        return { ...call, status: "stopped", finishedAt: nowIso() };
      }
      if (isMcpErrorResult(result)) {
        return { ...call, status: "error", finishedAt: nowIso(), error: summarizeJson(result, 800) || "MCP 工具返回错误" };
      }
      return { ...call, status: "success", finishedAt: nowIso(), outputSummary: summarizeJson(result, 800) };
    } catch (error) {
      return { ...call, status: "error", finishedAt: nowIso(), error: safeErrorText(error) };
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.values()].map((connection) => connection.close().catch(() => undefined)));
    this.connections.clear();
  }
}
