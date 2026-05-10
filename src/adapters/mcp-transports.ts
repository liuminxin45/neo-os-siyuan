import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "../models/mcp";

export interface RawMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ConnectedMcpServer {
  listTools(): Promise<RawMcpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export const connectMcpServer = async (server: McpServerConfig): Promise<ConnectedMcpServer> => {
  const client = new Client({
    name: "siyuan-addon",
    version: "0.1.0",
  });
  if (server.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: server.command || "",
      args: server.args || [],
      env: server.env,
      stderr: "pipe",
    });
    await client.connect(transport);
  } else if (server.transport === "sse") {
    const transport = new SSEClientTransport(new URL(server.url || ""));
    await client.connect(transport);
  } else {
    const transport = new StreamableHTTPClientTransport(new URL(server.url || ""));
    await client.connect(transport);
  }

  return {
    async listTools() {
      const response = await client.listTools();
      return response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },
    async callTool(name, args) {
      return client.callTool({ name, arguments: args });
    },
    async close() {
      await client.close();
    },
  };
};
