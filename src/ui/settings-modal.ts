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
      title: "AI 设置",
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
    root.append(this.renderLlmSection(), this.renderMcpSection());
  }

  private renderLlmSection(): HTMLElement {
    const settings = this.options.store.get();
    const section = createElement("section", "siyuan-addon-settings__section");
    section.append(createElement("h2", "siyuan-addon-settings__title", "LLM 配置"));

    const list = createElement("div", "siyuan-addon-list");
    if (settings.llmProfiles.length === 0) {
      list.append(createElement("p", "siyuan-addon-muted", "还没有 LLM 配置。"));
    }
    settings.llmProfiles.forEach((profile) => {
      const row = createElement("div", "siyuan-addon-list__row");
      const info = createElement(
        "div",
        "siyuan-addon-list__info",
        `${profile.name} · ${this.providerLabel(profile.provider)} · ${profile.model}`,
      );
      const masked = createElement(
        "div",
        "siyuan-addon-list__meta",
        `API Key: ${maskSecret(profile.apiKey)}`,
      );
      info.append(masked);
      const active = createElement("button", profile.id === settings.activeProfileId ? "b3-button b3-button--outline" : "b3-button", profile.id === settings.activeProfileId ? "当前" : "设为当前");
      active.addEventListener("click", async () => {
        await this.options.store.setLlmProfiles(settings.llmProfiles, profile.id);
        this.options.onSettingsChanged();
        this.render();
      });
      const edit = createElement("button", "b3-button b3-button--outline", "编辑");
      edit.addEventListener("click", () => this.renderLlmForm(cloneProfileToDraft(profile), profile));
      const remove = createElement("button", "b3-button b3-button--cancel", "删除");
      remove.addEventListener("click", async () => {
        const next = settings.llmProfiles.filter((item) => item.id !== profile.id);
        await this.options.store.setLlmProfiles(next, settings.activeProfileId === profile.id ? next[0]?.id : settings.activeProfileId);
        this.options.onSettingsChanged();
        this.render();
      });
      row.append(info, active, edit, remove);
      list.append(row);
    });

    const actions = createElement("div", "siyuan-addon-actions");
    const hasProvider = (provider: LlmProfile["provider"]): boolean => settings.llmProfiles.some((profile) => profile.provider === provider);
    if (!hasProvider("deepseek")) {
      const addDeepSeek = createElement("button", "b3-button b3-button--outline", "新增 DeepSeek");
      addDeepSeek.addEventListener("click", () => this.renderLlmForm(createEmptyLlmDraft("deepseek")));
      actions.append(addDeepSeek);
    }
    if (!hasProvider("openai-compatible")) {
      const addOpenAi = createElement("button", "b3-button b3-button--outline", "新增 OpenAI Compatible");
      addOpenAi.addEventListener("click", () => this.renderLlmForm(createEmptyLlmDraft("openai-compatible")));
      actions.append(addOpenAi);
    }
    if (!hasProvider("kimi-coding-plan")) {
      const addKimi = createElement("button", "b3-button b3-button--outline", "新增 Kimi CodingPlan");
      addKimi.addEventListener("click", () => this.renderLlmForm(createEmptyLlmDraft("kimi-coding-plan")));
      actions.append(addKimi);
    }
    section.append(list, actions);
    return section;
  }

  private renderLlmForm(draft: LlmProfileDraft, existing?: LlmProfile): void {
    const root = this.dialog?.element.querySelector(".siyuan-addon-settings") as HTMLElement | null;
    if (!root) return;
    root.innerHTML = "";
    const section = createElement("section", "siyuan-addon-settings__section");
    section.append(createElement("h2", "siyuan-addon-settings__title", existing ? "编辑 LLM 配置" : "新增 LLM 配置"));
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
    cancel.addEventListener("click", () => this.render());
    const actions = createElement("div", "siyuan-addon-actions");
    actions.append(save, cancel);
    section.append(errors, actions);
    root.append(section);
  }

  private renderMcpSection(): HTMLElement {
    const settings = this.options.store.get();
    const section = createElement("section", "siyuan-addon-settings__section");
    section.append(createElement("h2", "siyuan-addon-settings__title", "MCP 配置"));
    const list = createElement("div", "siyuan-addon-list");
    if (settings.mcpServers.length === 0) {
      list.append(createElement("p", "siyuan-addon-muted", "还没有 MCP Server。"));
    }
    settings.mcpServers.forEach((server) => {
      const row = createElement("div", "siyuan-addon-list__row");
      const info = createElement("div", "siyuan-addon-list__info", `${server.name} · ${server.transport} · ${server.status}`);
      if (server.lastError) info.append(createElement("div", "siyuan-addon-list__meta", server.lastError));
      const discover = createElement("button", "b3-button b3-button--outline", "发现工具");
      discover.addEventListener("click", () => this.discoverServer(server));
      const edit = createElement("button", "b3-button b3-button--outline", "编辑");
      edit.addEventListener("click", () => this.renderMcpForm(cloneServerToDraft(server), server));
      const remove = createElement("button", "b3-button b3-button--cancel", "删除");
      remove.addEventListener("click", async () => {
        await this.options.store.setMcpServers(settings.mcpServers.filter((item) => item.id !== server.id));
        this.options.onSettingsChanged();
        this.render();
      });
      row.append(info, discover, edit, remove);
      list.append(row);
    });
    const actions = createElement("div", "siyuan-addon-actions");
    (["stdio", "sse", "streamable-http"] as McpTransportType[]).forEach((transport) => {
      const button = createElement("button", "b3-button b3-button--outline", `新增 ${transport}`);
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
    section.append(createElement("h2", "siyuan-addon-settings__title", existing ? "编辑 MCP Server" : "新增 MCP Server"));
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
      const server = materializeMcpServer(nextDraft, existing);
      const servers = existing
        ? settings.mcpServers.map((item) => (item.id === existing.id ? server : item))
        : [...settings.mcpServers, server];
      await this.options.store.setMcpServers(servers);
      this.options.onSettingsChanged();
      this.render();
    });
    const cancel = createElement("button", "b3-button b3-button--outline", "取消");
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

  private textarea(labelText: string, value: string): HTMLTextAreaElement {
    const label = createElement("label", "siyuan-addon-field");
    const span = createElement("span", "", labelText);
    const textarea = document.createElement("textarea");
    textarea.className = "b3-text-field fn__block siyuan-addon-textarea";
    textarea.value = value;
    label.append(span, textarea);
    return textarea;
  }
}
