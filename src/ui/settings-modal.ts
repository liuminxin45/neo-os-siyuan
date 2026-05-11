import { Dialog, showMessage } from "siyuan";
import { cloneProfileToDraft, createEmptyLlmDraft, materializeLlmProfile, validateLlmProfile } from "../services/llm-profile-service";
import {
  cloneServerToDraft,
  materializeMcpServer,
  validateMcpServer,
  type McpValidationResult,
} from "../services/mcp-service";
import type { SettingsStore } from "../services/settings-store";
import type { McpService } from "../services/mcp-service";
import type { LlmProfile, LlmProfileDraft } from "../models/llm";
import type { McpServerConfig, McpServerDraft, McpTransportType } from "../models/mcp";
import { MAX_MEMORY_TURN_OPTIONS, type MaxMemoryTurns } from "../models/settings";
import { LLM_WIKI_DEFAULT_NOTEBOOK, type LlmWikiWriteMode } from "../models/llm-wiki";
import { maskSecret } from "../utils/masks";
import { createElement } from "./render";

interface SettingsModalOptions {
  store: SettingsStore;
  mcpService: McpService;
  onSettingsChanged: () => void;
}

export class SettingsModal {
  private dialog?: Dialog;

  constructor(private readonly options: SettingsModalOptions) {}

  open(): void {
    this.dialog = new Dialog({
      title: "LLM-Wiki 设置",
      content: '<div class="siyuan-addon-settings"></div>',
      width: "760px",
      height: "680px",
    });
    this.render();
  }

  private render(): void {
    const root = this.dialog?.element.querySelector(".siyuan-addon-settings") as HTMLElement | null;
    if (!root) return;
    root.innerHTML = "";
    root.append(this.renderLlmSection(), this.renderMemorySection(), this.renderLlmWikiSection(), this.renderMcpSection());
  }

  private renderLlmSection(): HTMLElement {
    const settings = this.options.store.get();
    const section = createElement("section", "siyuan-addon-settings__section");
    section.append(this.sectionHeader("LLM 配置", "只保留模型、端点和密钥这些高频必要项。"));

    const list = createElement("div", "siyuan-addon-list");
    if (settings.llmProfiles.length === 0) {
      list.append(createElement("p", "siyuan-addon-muted", "还没有 LLM 配置。"));
    }
    settings.llmProfiles.forEach((profile) => {
      const row = createElement("div", "siyuan-addon-list__row");
      const info = createElement("div", "siyuan-addon-list__info");
      const title = createElement("div", "siyuan-addon-list__title");
      title.append(
        createElement("span", "", profile.name),
        createElement("span", "siyuan-addon-status", this.providerLabel(profile.provider)),
      );
      if (profile.id === settings.activeProfileId) {
        title.append(createElement("span", "siyuan-addon-status siyuan-addon-status--active", "当前"));
      }
      const masked = createElement("div", "siyuan-addon-list__meta", `${profile.model} · API Key ${maskSecret(profile.apiKey)}`);
      info.append(title, masked);
      const rowActions = createElement("div", "siyuan-addon-list__row-actions");
      const active = createElement("button", profile.id === settings.activeProfileId ? "b3-button b3-button--outline" : "b3-button", profile.id === settings.activeProfileId ? "当前" : "设为当前");
      active.type = "button";
      active.disabled = profile.id === settings.activeProfileId;
      active.addEventListener("click", async () => {
        await this.options.store.setLlmProfiles(settings.llmProfiles, profile.id);
        this.options.onSettingsChanged();
        this.render();
      });
      const edit = createElement("button", "b3-button b3-button--outline", "编辑");
      edit.type = "button";
      edit.addEventListener("click", () => this.renderLlmForm(cloneProfileToDraft(profile), profile));
      const remove = createElement("button", "b3-button b3-button--cancel", "删除");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        const next = settings.llmProfiles.filter((item) => item.id !== profile.id);
        await this.options.store.setLlmProfiles(next, settings.activeProfileId === profile.id ? next[0]?.id : settings.activeProfileId);
        this.options.onSettingsChanged();
        this.render();
      });
      rowActions.append(active, edit, remove);
      row.append(info, rowActions);
      list.append(row);
    });

    const actions = createElement("div", "siyuan-addon-actions");
    const hasProvider = (provider: LlmProfile["provider"]): boolean => settings.llmProfiles.some((profile) => profile.provider === provider);
    if (!hasProvider("deepseek")) {
      const addDeepSeek = createElement("button", "b3-button b3-button--outline", "新增 DeepSeek");
      addDeepSeek.type = "button";
      addDeepSeek.addEventListener("click", () => this.renderLlmForm(createEmptyLlmDraft("deepseek")));
      actions.append(addDeepSeek);
    }
    if (!hasProvider("openai-compatible")) {
      const addOpenAi = createElement("button", "b3-button b3-button--outline", "新增 OpenAI Compatible");
      addOpenAi.type = "button";
      addOpenAi.addEventListener("click", () => this.renderLlmForm(createEmptyLlmDraft("openai-compatible")));
      actions.append(addOpenAi);
    }
    if (!hasProvider("kimi-coding-plan")) {
      const addKimi = createElement("button", "b3-button b3-button--outline", "新增 Kimi CodingPlan");
      addKimi.type = "button";
      addKimi.addEventListener("click", () => this.renderLlmForm(createEmptyLlmDraft("kimi-coding-plan")));
      actions.append(addKimi);
    }
    section.append(list, actions);
    return section;
  }

  private renderMemorySection(): HTMLElement {
    const settings = this.options.store.get();
    const section = createElement("section", "siyuan-addon-settings__section");
    section.append(this.sectionHeader("对话记忆", "控制发送给模型的最近上下文长度。"));
    const select = this.select(
      "最大记忆对话轮次",
      MAX_MEMORY_TURN_OPTIONS.map((value) => ({ label: `${value} 轮`, value: String(value) })),
      String(settings.maxMemoryTurns || 10),
    );
    select.addEventListener("change", async () => {
      const value = Number(select.value) as MaxMemoryTurns;
      if (!MAX_MEMORY_TURN_OPTIONS.includes(value)) return;
      await this.options.store.setMaxMemoryTurns(value);
      this.options.onSettingsChanged();
    });
    section.append(select.parentElement!);
    return section;
  }

  private renderLlmWikiSection(): HTMLElement {
    const settings = this.options.store.get();
    const section = createElement("section", "siyuan-addon-settings__section");
    section.append(this.sectionHeader("LLM-Wiki 知识库", "保持 AGENTS、wiki、raw、skills、runs 五层核心可控。"));

    const enabled = document.createElement("label");
    enabled.className = "siyuan-addon-checkbox";
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = settings.llmWiki.enabled;
    enabled.append(enabledInput, " 启用知识库内核");

    const notebookName = this.input("笔记本名称", settings.llmWiki.notebookName || LLM_WIKI_DEFAULT_NOTEBOOK);
    const writeMode = this.select(
      "写入模式",
      [
        { label: "自动新增/更新，阻止高风险操作", value: "auto-safe" },
        { label: "先输出变更草案", value: "draft-first" },
        { label: "只读", value: "read-only" },
      ],
      settings.llmWiki.writeMode,
    );
    const allowedServers = this.textarea("允许的 MCP Server ID（每行一个；留空表示全部）", settings.llmWiki.allowedMcpServerIds.join("\n"));
    const allowedTools = this.textarea("允许的 MCP Tool 名称（每行一个；留空表示全部）", settings.llmWiki.toolAllowlist.join("\n"));
    const save = createElement("button", "b3-button", "保存知识库设置");
    save.type = "button";
    save.addEventListener("click", async () => {
      await this.options.store.setLlmWikiSettings({
        enabled: enabledInput.checked,
        notebookName: notebookName.value.trim() || LLM_WIKI_DEFAULT_NOTEBOOK,
        writeMode: writeMode.value as LlmWikiWriteMode,
        language: "zh-CN",
        allowedMcpServerIds: this.listFromTextarea(allowedServers.value),
        toolAllowlist: this.listFromTextarea(allowedTools.value),
      });
      this.options.onSettingsChanged();
      showMessage("LLM-Wiki 设置已保存");
      this.render();
    });
    const actions = createElement("div", "siyuan-addon-actions");
    actions.append(save);
    section.append(
      enabled,
      notebookName.parentElement!,
      writeMode.parentElement!,
      allowedServers.parentElement!,
      allowedTools.parentElement!,
      actions,
    );
    return section;
  }

  private renderLlmForm(draft: LlmProfileDraft, existing?: LlmProfile): void {
    const root = this.dialog?.element.querySelector(".siyuan-addon-settings") as HTMLElement | null;
    if (!root) return;
    root.innerHTML = "";
    const section = createElement("section", "siyuan-addon-settings__section");
    section.append(this.sectionHeader(existing ? "编辑 LLM 配置" : "新增 LLM 配置", "保存后会立即成为可选模型 Profile。"));
    const provider = this.input("Provider", draft.provider);
    provider.disabled = true;
    const name = this.input("名称", draft.name);
    const baseUrl = this.input("Base URL", draft.baseUrl || "");
    const apiKey = this.input("API Key", draft.apiKey || "", "password");
    const model = this.input("Model", draft.model);
    section.append(provider.parentElement!, name.parentElement!);
    if (draft.provider === "openai-compatible") section.append(baseUrl.parentElement!);
    if (draft.provider === "kimi-coding-plan") {
      const fixedUrl = createElement("div", "siyuan-addon-list__meta", `固定端点：${draft.baseUrl || "https://api.kimi.com/coding"}`);
      section.append(fixedUrl, apiKey.parentElement!);
    } else {
      section.append(apiKey.parentElement!);
    }
    section.append(model.parentElement!);
    const errors = createElement("div", "siyuan-addon-form-errors");
    const save = createElement("button", "b3-button", "保存");
    save.type = "button";
    save.addEventListener("click", async () => {
      const nextDraft: LlmProfileDraft = {
        id: draft.id,
        provider: draft.provider,
        name: name.value,
        baseUrl: baseUrl.value,
        apiKey: apiKey.value,
        model: model.value,
      };
      const validation = validateLlmProfile(nextDraft);
      if (!validation.ok) {
        errors.textContent = Object.values(validation.errors).join("；");
        return;
      }
      const settings = this.options.store.get();
      const profile = materializeLlmProfile(nextDraft, existing);
      const profiles = existing
        ? settings.llmProfiles.map((item) => (item.id === existing.id ? profile : item))
        : [...settings.llmProfiles, profile];
      await this.options.store.setLlmProfiles(profiles, settings.activeProfileId || profile.id);
      this.options.onSettingsChanged();
      this.render();
    });
    const cancel = createElement("button", "b3-button b3-button--outline", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", () => this.render());
    const actions = createElement("div", "siyuan-addon-actions");
    actions.append(save, cancel);
    section.append(errors, actions);
    root.append(section);
  }

  private renderMcpSection(): HTMLElement {
    const settings = this.options.store.get();
    const section = createElement("section", "siyuan-addon-settings__section");
    section.append(this.sectionHeader("MCP 配置", "统一管理可被 AI 自动调用的工具服务。"));
    const list = createElement("div", "siyuan-addon-list");
    if (settings.mcpServers.length === 0) {
      list.append(createElement("p", "siyuan-addon-muted", "还没有 MCP Server。"));
    }
    settings.mcpServers.forEach((server) => {
      const row = createElement("div", "siyuan-addon-list__row");
      const info = createElement("div", "siyuan-addon-list__info");
      const title = createElement("div", "siyuan-addon-list__title");
      title.append(
        createElement("span", "", server.name),
        createElement("span", "siyuan-addon-status", server.transport),
        createElement("span", `siyuan-addon-status siyuan-addon-status--${server.status}`, server.status),
      );
      if (server.lastError) info.append(createElement("div", "siyuan-addon-list__meta", server.lastError));
      info.prepend(title);
      const rowActions = createElement("div", "siyuan-addon-list__row-actions");
      const discover = createElement("button", "b3-button b3-button--outline", "发现工具");
      discover.type = "button";
      discover.addEventListener("click", () => this.discoverServer(server));
      const edit = createElement("button", "b3-button b3-button--outline", "编辑");
      edit.type = "button";
      edit.addEventListener("click", () => this.renderMcpForm(cloneServerToDraft(server), server));
      const remove = createElement("button", "b3-button b3-button--cancel", "删除");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        await this.options.mcpService.closeServer(server.id);
        await this.options.store.setMcpServers(settings.mcpServers.filter((item) => item.id !== server.id));
        await this.options.store.removeToolCache(server.id);
        this.options.onSettingsChanged();
        this.render();
      });
      rowActions.append(discover, edit, remove);
      row.append(info, rowActions);
      list.append(row);
    });
    const actions = createElement("div", "siyuan-addon-actions");
    (["stdio", "sse", "streamable-http"] as McpTransportType[]).forEach((transport) => {
      const button = createElement("button", "b3-button b3-button--outline", `新增 ${transport}`);
      button.type = "button";
      button.addEventListener("click", () =>
        this.renderMcpForm({ name: transport, transport, enabled: true, command: "", argsText: "", envText: "", url: "" }),
      );
      actions.append(button);
    });
    section.append(list, actions);
    return section;
  }

  private renderMcpForm(draft: McpServerDraft, existing?: McpServerConfig, validation?: McpValidationResult): void {
    const root = this.dialog?.element.querySelector(".siyuan-addon-settings") as HTMLElement | null;
    if (!root) return;
    root.innerHTML = "";
    const section = createElement("section", "siyuan-addon-settings__section");
    section.append(this.sectionHeader(existing ? "编辑 MCP Server" : "新增 MCP Server", "保存后会刷新对应工具缓存。"));
    const name = this.input("名称", draft.name);
    const enabled = document.createElement("label");
    enabled.className = "siyuan-addon-checkbox";
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = draft.enabled;
    enabled.append(enabledInput, " 启用并允许自动调用");
    section.append(name.parentElement!, enabled);
    let command: HTMLInputElement | undefined;
    let args: HTMLTextAreaElement | undefined;
    let env: HTMLTextAreaElement | undefined;
    let url: HTMLInputElement | undefined;
    if (draft.transport === "stdio") {
      command = this.input("命令", draft.command || "");
      args = this.textarea("参数（每行一个或逗号分隔）", draft.argsText || "");
      env = this.textarea("环境变量（KEY=VALUE，每行一个）", draft.envText || "");
      section.append(command.parentElement!, args.parentElement!, env.parentElement!);
    } else {
      url = this.input(draft.transport === "sse" ? "SSE URL" : "Streamable HTTP URL", draft.url || "");
      section.append(url.parentElement!);
    }
    const errors = createElement("div", "siyuan-addon-form-errors", validation ? Object.values(validation.errors).join("；") : "");
    const save = createElement("button", "b3-button", "保存");
    save.type = "button";
    save.addEventListener("click", async () => {
      const nextDraft: McpServerDraft = {
        id: draft.id,
        name: name.value,
        transport: draft.transport,
        enabled: enabledInput.checked,
        command: command?.value,
        argsText: args?.value,
        envText: env?.value,
        url: url?.value,
      };
      const nextValidation = validateMcpServer(nextDraft);
      if (!nextValidation.ok) {
        this.renderMcpForm(nextDraft, existing, nextValidation);
        return;
      }
      const settings = this.options.store.get();
      const materialized = materializeMcpServer(nextDraft, existing);
      const server = existing ? { ...materialized, status: "idle" as const } : materialized;
      const servers = existing
        ? settings.mcpServers.map((item) => (item.id === existing.id ? server : item))
        : [...settings.mcpServers, server];
      await this.options.store.setMcpServers(servers);
      if (existing) {
        await this.options.mcpService.closeServer(existing.id);
        await this.options.store.removeToolCache(existing.id);
      }
      this.options.onSettingsChanged();
      this.render();
    });
    const cancel = createElement("button", "b3-button b3-button--outline", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", () => this.render());
    const actions = createElement("div", "siyuan-addon-actions");
    actions.append(save, cancel);
    section.append(errors, actions);
    root.append(section);
  }

  private async discoverServer(server: McpServerConfig): Promise<void> {
    showMessage(`正在发现 ${server.name} 的工具...`);
    const result = await this.options.mcpService.discover(server);
    const settings = this.options.store.get();
    await this.options.store.setMcpServers(settings.mcpServers.map((item) => (item.id === server.id ? result.server : item)));
    await this.options.store.setToolCache(server.id, result.tools);
    this.options.onSettingsChanged();
    this.render();
    showMessage(result.server.status === "ready" ? `发现 ${result.tools.length} 个工具` : "工具发现失败", 3000, result.server.status === "ready" ? "info" : "error");
  }

  private providerLabel(provider: LlmProfile["provider"]): string {
    if (provider === "deepseek") return "DeepSeek";
    if (provider === "kimi-coding-plan") return "Kimi CodingPlan";
    return "OpenAI Compatible";
  }

  private sectionHeader(title: string, description: string): HTMLElement {
    const header = createElement("div", "siyuan-addon-settings__header");
    header.append(createElement("h2", "siyuan-addon-settings__title", title));
    header.append(createElement("div", "siyuan-addon-settings__desc", description));
    return header;
  }

  private input(labelText: string, value: string, type = "text"): HTMLInputElement {
    const label = createElement("label", "siyuan-addon-field");
    const span = createElement("span", "", labelText);
    const input = document.createElement("input");
    input.className = "b3-text-field fn__block";
    input.type = type;
    input.value = value;
    label.append(span, input);
    return input;
  }

  private select(labelText: string, options: Array<{ label: string; value: string }>, value: string): HTMLSelectElement {
    const label = createElement("label", "siyuan-addon-field");
    const span = createElement("span", "", labelText);
    const select = document.createElement("select");
    select.className = "b3-select fn__block";
    options.forEach((option) => {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      item.selected = option.value === value;
      select.append(item);
    });
    label.append(span, select);
    return select;
  }

  private textarea(labelText: string, value: string): HTMLTextAreaElement {
    const label = createElement("label", "siyuan-addon-field");
    const span = createElement("span", "", labelText);
    const textarea = document.createElement("textarea");
    textarea.className = "b3-text-field fn__block siyuan-addon-textarea";
    textarea.value = value;
    label.append(span, textarea);
    return textarea;
  }

  private listFromTextarea(value: string): string[] {
    return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
  }
}
