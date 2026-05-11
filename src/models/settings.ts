import type { LlmProfile } from "./llm";
import type { McpServerConfig, McpTool } from "./mcp";
import type { AgentMode } from "./agent";
import type { LlmWikiSettings } from "./llm-wiki";
import { defaultLlmWikiSettings } from "./llm-wiki";

export type MaxMemoryTurns = 5 | 10 | 20 | 30;

export interface PluginSettings {
  schemaVersion: number;
  activeProfileId?: string;
  llmProfiles: LlmProfile[];
  mcpServers: McpServerConfig[];
  mcpToolCache?: Record<string, McpTool[]>;
  agentMode?: AgentMode;
  maxMemoryTurns?: MaxMemoryTurns;
  llmWiki: LlmWikiSettings;
}

export const SETTINGS_STORAGE_KEY = "settings";
export const SETTINGS_SCHEMA_VERSION = 1;
export const DEFAULT_MAX_MEMORY_TURNS: MaxMemoryTurns = 10;
export const MAX_MEMORY_TURN_OPTIONS: MaxMemoryTurns[] = [5, 10, 20, 30];

export const defaultSettings = (): PluginSettings => ({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  activeProfileId: undefined,
  llmProfiles: [],
  mcpServers: [],
  mcpToolCache: {},
  agentMode: "react",
  maxMemoryTurns: DEFAULT_MAX_MEMORY_TURNS,
  llmWiki: defaultLlmWikiSettings(),
});
