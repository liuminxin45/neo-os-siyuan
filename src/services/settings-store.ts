import type { Plugin } from "siyuan";
import type { LlmProfile } from "../models/llm";
import type { McpServerConfig, McpTool } from "../models/mcp";
import {
  defaultSettings,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEY,
  type PluginSettings,
} from "../models/settings";

const normalizeSettings = (raw: Partial<PluginSettings> | null | undefined): PluginSettings => {
  const fallback = defaultSettings();
  const llmProfiles = Array.isArray(raw?.llmProfiles) ? raw.llmProfiles : [];
  const mcpServers = Array.isArray(raw?.mcpServers) ? raw.mcpServers : [];
  const activeProfileId = llmProfiles.some((profile) => profile.id === raw?.activeProfileId)
    ? raw?.activeProfileId
    : llmProfiles[0]?.id;
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    activeProfileId,
    llmProfiles,
    mcpServers,
    mcpToolCache: raw?.mcpToolCache || fallback.mcpToolCache,
  };
};

export class SettingsStore {
  private settings: PluginSettings = defaultSettings();

  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<PluginSettings> {
    let raw: Partial<PluginSettings> | null = null;
    try {
      raw = (await this.plugin.loadData(SETTINGS_STORAGE_KEY)) as Partial<PluginSettings> | null;
    } catch {
      raw = null;
    }
    this.settings = normalizeSettings(raw);
    return this.get();
  }

  get(): PluginSettings {
    return structuredClone(this.settings);
  }

  async save(next: PluginSettings): Promise<PluginSettings> {
    this.settings = normalizeSettings(next);
    await this.plugin.saveData(SETTINGS_STORAGE_KEY, this.settings);
    return this.get();
  }

  async setLlmProfiles(llmProfiles: LlmProfile[], activeProfileId?: string): Promise<PluginSettings> {
    return this.save({ ...this.settings, llmProfiles, activeProfileId });
  }

  async setMcpServers(mcpServers: McpServerConfig[]): Promise<PluginSettings> {
    return this.save({ ...this.settings, mcpServers });
  }

  async setToolCache(serverId: string, tools: McpTool[]): Promise<PluginSettings> {
    return this.save({
      ...this.settings,
      mcpToolCache: { ...(this.settings.mcpToolCache || {}), [serverId]: tools },
    });
  }
}
