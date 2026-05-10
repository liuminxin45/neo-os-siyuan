import type { LlmProfile } from "./llm";
import type { McpServerConfig, McpTool } from "./mcp";

export interface PluginSettings {
  schemaVersion: number;
  activeProfileId?: string;
  llmProfiles: LlmProfile[];
  mcpServers: McpServerConfig[];
  mcpToolCache?: Record<string, McpTool[]>;
}

export const SETTINGS_STORAGE_KEY = "settings";
export const SETTINGS_SCHEMA_VERSION = 1;

export const defaultSettings = (): PluginSettings => ({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  activeProfileId: undefined,
  llmProfiles: [],
  mcpServers: [],
  mcpToolCache: {},
});
