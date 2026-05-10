import type { LlmProfile } from "./llm";
import type { McpServerConfig, McpTool } from "./mcp";
import type { AgentMode } from "./agent";

export interface PluginSettings {
  schemaVersion: number;
  activeProfileId?: string;
  llmProfiles: LlmProfile[];
  mcpServers: McpServerConfig[];
  mcpToolCache?: Record<string, McpTool[]>;
  agentMode?: AgentMode;
}

export const SETTINGS_STORAGE_KEY = "settings";
export const SETTINGS_SCHEMA_VERSION = 1;

export const defaultSettings = (): PluginSettings => ({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  activeProfileId: undefined,
  llmProfiles: [],
  mcpServers: [],
  mcpToolCache: {},
  agentMode: "react",
});
