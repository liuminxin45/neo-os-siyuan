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

const MCP_SESSION_RECONNECT_DELAY_MS = 120;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRecoverableMcpSessionError = (error: unknown): boolean => {
  const text = safeErrorText(error);
  return /Server not initialized|Mcp-Session-Id header is required|No valid session ID|Invalid session ID|session.*(?:expired|invalid|not found)|not initialized/i.test(
    text,
  );
};

const summarizeToolResult = (tool: McpTool, args: Record<string, unknown>, result: unknown): string => {
  const action = typeof args.action === "string" ? args.action : "";
  const limit = action === "read" || action === "get_doc" ? 12000 : action === "fulltext" || action === "search" ? 5000 : 2000;
  return summarizeJson(result, limit);
};

type ManagedMcpConnection = {
  connection: ConnectedMcpServer;
  fingerprint: string;
  server: McpServerConfig;
};

export class McpService {
  private connections = new Map<string, ManagedMcpConnection>();
  private pendingDiscoveries = new Map<string, Promise<{ server: McpServerConfig; tools: McpTool[] }>>();
  private generations = new Map<string, number>();
  private tools = new Map<string, McpTool[]>();

  getTools(): McpTool[] {
    return [...this.tools.values()].flat();
  }

  async discover(server: McpServerConfig): Promise<{ server: McpServerConfig; tools: McpTool[] }> {
    const fingerprint = this.connectionFingerprint(server);
    const pendingKey = `${server.id}:${fingerprint}`;
    const pending = this.pendingDiscoveries.get(pendingKey);
    if (pending) return pending;
    const discovery = this.discoverOnce(server, fingerprint).finally(() => {
      if (this.pendingDiscoveries.get(pendingKey) === discovery) {
        this.pendingDiscoveries.delete(pendingKey);
      }
    });
    this.pendingDiscoveries.set(pendingKey, discovery);
    return discovery;
  }

  private async discoverOnce(server: McpServerConfig, fingerprint: string): Promise<{ server: McpServerConfig; tools: McpTool[] }> {
    const nextServer: McpServerConfig = { ...server, status: "validating", lastError: undefined };
    const existing = this.connections.get(server.id);
    if (existing && existing.fingerprint !== fingerprint) {
      await this.closeServer(server.id);
    }

    const generation = this.generations.get(server.id) || 0;
    let connection = this.connections.get(server.id)?.connection;
    let ownsNewConnection = false;
    try {
      if (!connection) {
        connection = await connectMcpServer(server);
        ownsNewConnection = true;
      }
      let rawTools: Awaited<ReturnType<ConnectedMcpServer["listTools"]>>;
      try {
        rawTools = await connection.listTools();
      } catch (error) {
        if (!isRecoverableMcpSessionError(error)) throw error;
        connection = await this.reconnectAfterSessionLoss(server, connection);
        ownsNewConnection = true;
        rawTools = await connection.listTools();
      }
      if ((this.generations.get(server.id) || 0) !== generation) {
        if (ownsNewConnection) await connection.close().catch(() => undefined);
        return { server: { ...nextServer, status: "idle", updatedAt: nowIso() }, tools: [] };
      }
      const tools = rawTools.map((tool) => ({
        serverId: server.id,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        llmName: createLlmToolName(server, tool.name),
      }));
      this.connections.set(server.id, { connection, fingerprint, server });
      this.tools.set(server.id, tools);
      return { server: { ...nextServer, status: "ready", updatedAt: nowIso() }, tools };
    } catch (error) {
      if (connection && (ownsNewConnection || isRecoverableMcpSessionError(error))) {
        await connection.close().catch(() => undefined);
        this.connections.delete(server.id);
        this.tools.delete(server.id);
      }
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
      const managed = this.connections.get(tool.serverId);
      if (!managed) throw new Error("MCP 未连接");
      let result: unknown;
      try {
        result = await managed.connection.callTool(tool.name, args);
      } catch (error) {
        if (!isRecoverableMcpSessionError(error)) throw error;
        const connection = await this.reconnectAfterSessionLoss(managed.server, managed.connection);
        this.connections.set(tool.serverId, { ...managed, connection });
        result = await connection.callTool(tool.name, args);
      }
      if (generationId.endsWith(":stopped")) {
        return { ...call, status: "stopped", finishedAt: nowIso() };
      }
      if (isMcpErrorResult(result)) {
        return { ...call, status: "error", finishedAt: nowIso(), error: summarizeJson(result, 800) || "MCP 工具返回错误" };
      }
      return { ...call, status: "success", finishedAt: nowIso(), outputSummary: summarizeToolResult(tool, args, result) };
    } catch (error) {
      if (isRecoverableMcpSessionError(error)) {
        const managed = this.connections.get(tool.serverId);
        this.connections.delete(tool.serverId);
        this.tools.delete(tool.serverId);
        if (managed) await managed.connection.close().catch(() => undefined);
      }
      return { ...call, status: "error", finishedAt: nowIso(), error: safeErrorText(error) };
    }
  }

  async closeServer(serverId: string): Promise<void> {
    this.bumpGeneration(serverId);
    const managed = this.connections.get(serverId);
    this.connections.delete(serverId);
    this.tools.delete(serverId);
    if (managed) await managed.connection.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    for (const serverId of this.connections.keys()) this.bumpGeneration(serverId);
    const connections = [...this.connections.values()].map(({ connection }) => connection);
    this.connections.clear();
    this.tools.clear();
    this.pendingDiscoveries.clear();
    await Promise.all(connections.map((connection) => connection.close().catch(() => undefined)));
  }

  private bumpGeneration(serverId: string): void {
    this.generations.set(serverId, (this.generations.get(serverId) || 0) + 1);
  }

  private async reconnectAfterSessionLoss(server: McpServerConfig, connection?: ConnectedMcpServer): Promise<ConnectedMcpServer> {
    if (connection) await connection.close().catch(() => undefined);
    this.connections.delete(server.id);
    await delay(MCP_SESSION_RECONNECT_DELAY_MS);
    return connectMcpServer(server);
  }

  private connectionFingerprint(server: McpServerConfig): string {
    return JSON.stringify({
      transport: server.transport,
      command: server.command || "",
      args: server.args || [],
      env: Object.fromEntries(Object.entries(server.env || {}).sort(([left], [right]) => left.localeCompare(right))),
      url: server.url || "",
    });
  }
}
