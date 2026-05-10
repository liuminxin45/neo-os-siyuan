import type { ChatService } from "../services/chat-service";
import type { SettingsStore } from "../services/settings-store";
import type { ChatMessage, ChatSession } from "../models/chat";
import type { SkillIndexItem } from "../models/skill";
import { createElement } from "./render";
import { renderMarkdown } from "./markdown";
import { SettingsModal } from "./settings-modal";
import type { McpService } from "../services/mcp-service";
import type { SiyuanSkillIndexReader } from "../services/siyuan-skill-index";
import type { SiyuanDocumentOpener } from "../services/siyuan-document-opener";

interface ChatDockOptions {
  chatService: ChatService;
  settingsStore: SettingsStore;
  mcpService: McpService;
  skillIndexReader: SiyuanSkillIndexReader;
  documentOpener: SiyuanDocumentOpener;
}

export class ChatDock {
  private root?: HTMLElement;
  private draft = "";
  private selectedSkill?: SkillIndexItem;
  private skillItems: SkillIndexItem[] = [];
  private skillLoadStatus: "idle" | "loading" | "ready" | "error" = "idle";
  private skillLoadError = "";
  private skillLoadPromise?: Promise<void>;
  private activeSkillIndex = 0;
  private focusComposerAfterRender = false;
  private unsubscribe?: () => void;
  private readonly traceOpenState = new Map<string, boolean>();
  private settingsModal: SettingsModal;
  private readonly handleRootPointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    const stopButton = target?.closest<HTMLElement>("[data-siyuan-addon-action='stop']");
    if (!stopButton || !this.root?.contains(stopButton)) return;
    event.preventDefault();
    event.stopPropagation();
    this.options.chatService.stop();
  };

  constructor(private readonly options: ChatDockOptions) {
    this.settingsModal = new SettingsModal({
      store: options.settingsStore,
      mcpService: options.mcpService,
      onSettingsChanged: () => this.render(this.options.chatService.snapshot()),
    });
  }

  mount(root: HTMLElement): void {
    this.root = root;
    this.root.addEventListener("pointerdown", this.handleRootPointerDown, true);
    this.unsubscribe?.();
    this.unsubscribe = this.options.chatService.subscribe((session) => this.render(session));
  }

  unmount(): void {
    this.root?.removeEventListener("pointerdown", this.handleRootPointerDown, true);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.root = undefined;
  }

  render(session: ChatSession): void {
    if (!this.root) return;
    const messageIds = new Set(session.messages.map((message) => message.id));
    for (const messageId of this.traceOpenState.keys()) {
      if (!messageIds.has(messageId)) this.traceOpenState.delete(messageId);
    }
    this.root.innerHTML = "";
    const shell = createElement("div", "siyuan-addon-chat");
    const header = createElement("header", "siyuan-addon-chat__header");
    const title = createElement("div", "siyuan-addon-chat__title", "AI Chat");
    const headerActions = createElement("div", "siyuan-addon-chat__header-actions");
    headerActions.append(this.renderSessionPicker(session));
    const settings = createElement("button", "siyuan-addon-icon-button", "设置");
    settings.addEventListener("click", () => this.settingsModal.open());
    headerActions.append(settings);
    header.append(title, headerActions);

    const messages = createElement("div", "siyuan-addon-chat__messages");
    if (session.messages.length === 0) {
      const empty = createElement("div", "siyuan-addon-empty");
      const active = this.options.settingsStore.get().activeProfileId;
      empty.textContent = session.archiveStatus === "loading"
        ? "正在加载聊天存档..."
        : active
          ? "输入问题开始聊天。"
          : "请先在设置中添加 LLM 配置。";
      messages.append(empty);
    }
    if (session.archiveStatus === "error" && session.archiveError) {
      messages.append(createElement("div", "siyuan-addon-archive-error", session.archiveError));
    }
    session.messages.forEach((message) => {
      const item = createElement("article", `siyuan-addon-message siyuan-addon-message--${message.role}`);
      const meta = createElement("div", "siyuan-addon-message__meta");
      meta.append(createElement("span", "", this.metaText(message.role, message.status)));
      const messageActions = createElement("div", "siyuan-addon-message__actions");
      const copy = createElement("button", "siyuan-addon-message__button", "复制");
      copy.type = "button";
      copy.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.copyText(this.copyableMessageText(message));
      });
      messageActions.append(copy);
      meta.append(messageActions);
      const content = createElement("div", "siyuan-addon-message__content");
      renderMarkdown(content, message.content, { onOpenDocument: (target) => void this.options.documentOpener.open(target) });
      item.append(meta, content);
      const references = this.renderReferences(message);
      if (references) item.append(references);
      const trace = this.renderReActTrace(message);
      if (trace) item.append(trace);
      if (message.pauseHint) {
        item.append(createElement("div", "siyuan-addon-message__pause", message.pauseHint));
      }
      messages.append(item);
    });

    const canContinue = Boolean(session.continuation && !session.isGenerating && !this.draft.trim() && !this.selectedSkill);
    const form = createElement("div", "siyuan-addon-composer");
    if (this.selectedSkill) form.append(this.renderSelectedSkill());
    const textarea = document.createElement("textarea");
    textarea.className = "b3-text-field siyuan-addon-composer__input";
    textarea.placeholder = this.selectedSkill
      ? `描述你想用 ${this.selectedSkill.name} 完成的目标`
      : "输入消息，/ 选择 skill，Enter 发送，Shift+Enter 换行";
    textarea.value = this.draft;
    textarea.disabled = session.isGenerating;
    textarea.addEventListener("input", () => {
      const wasSlashActive = this.isSlashActive();
      this.draft = textarea.value;
      if (this.isSlashActive()) {
        this.activeSkillIndex = 0;
        void this.ensureSkillsLoaded();
        this.focusComposerAfterRender = true;
        this.render(session);
        return;
      }
      if (wasSlashActive) {
        this.activeSkillIndex = 0;
        this.focusComposerAfterRender = true;
        this.render(session);
      }
    });
    textarea.addEventListener("keydown", (event) => {
      if (this.handleSkillPaletteKeydown(event, session)) return;
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (canContinue) {
          void this.options.chatService.continue();
          return;
        }
        this.send();
      }
    });
    const actions = createElement("div", "siyuan-addon-composer__actions");
    const clear = createElement("button", "b3-button b3-button--outline", "清空");
    clear.addEventListener("click", () => {
      this.draft = "";
      this.selectedSkill = undefined;
      this.options.chatService.clear();
    });
    const primaryClass = session.isGenerating || canContinue ? "b3-button b3-button--cancel" : "b3-button";
    const primaryLabel = session.isGenerating ? "停止" : canContinue ? "继续" : "发送";
    const primary = createElement("button", primaryClass, primaryLabel);
    primary.dataset.siyuanAddonAction = session.isGenerating ? "stop" : canContinue ? "continue" : "send";
    primary.addEventListener("click", () => {
      if (session.isGenerating) {
        this.options.chatService.stop();
        return;
      }
      if (canContinue) {
        void this.options.chatService.continue();
        return;
      }
      this.send();
    });
    actions.append(clear, primary);
    form.append(textarea);
    const skillPalette = this.renderSkillPalette();
    if (skillPalette) form.append(skillPalette);
    form.append(actions);
    shell.append(header, messages, form);
    this.root.append(shell);
    messages.scrollTop = messages.scrollHeight;
    if (this.focusComposerAfterRender && !session.isGenerating) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      this.focusComposerAfterRender = false;
    }
  }

  private send(): void {
    const value = this.draft;
    const skill = this.selectedSkill;
    this.draft = "";
    this.selectedSkill = undefined;
    void this.options.chatService.send(value, { skill });
  }

  private renderSessionPicker(session: ChatSession): HTMLElement {
    const wrapper = createElement("div", "siyuan-addon-session-picker");
    const select = document.createElement("select");
    select.className = "b3-select siyuan-addon-session-picker__select";
    select.disabled = session.isGenerating || session.archiveStatus === "loading";
    const currentArchived = session.archives.some((item) => item.conversationId === session.conversationId);
    const newOption = document.createElement("option");
    newOption.value = "__new__";
    newOption.textContent = session.archiveStatus === "loading" ? "加载中..." : "新对话";
    select.append(newOption);
    for (const item of session.archives) {
      const option = document.createElement("option");
      option.value = item.conversationId;
      option.textContent = `${item.title} · ${item.messageCount}`;
      option.title = item.fileName;
      select.append(option);
    }
    select.value = currentArchived ? session.conversationId : "__new__";
    select.addEventListener("change", () => {
      if (select.value === "__new__") {
        this.options.chatService.clear();
        return;
      }
      void this.options.chatService.switchArchive(select.value);
    });
    const remove = createElement("button", "siyuan-addon-icon-button siyuan-addon-session-picker__delete", "删除") as HTMLButtonElement;
    remove.type = "button";
    remove.disabled = session.isGenerating || !currentArchived;
    remove.addEventListener("click", () => {
      const active = session.archives.find((item) => item.conversationId === session.conversationId);
      if (!active) return;
      if (!window.confirm(`删除对话存档 ${active.fileName}？`)) return;
      void this.options.chatService.deleteArchive(active.conversationId);
    });
    wrapper.append(select, remove);
    return wrapper;
  }

  private renderSelectedSkill(): HTMLElement {
    const wrapper = createElement("div", "siyuan-addon-skill-chip");
    wrapper.append(createElement("span", "", `使用 skill：${this.selectedSkill?.name || ""}`));
    const clear = createElement("button", "siyuan-addon-message__button", "移除");
    clear.type = "button";
    clear.addEventListener("click", () => {
      this.selectedSkill = undefined;
      this.render(this.options.chatService.snapshot());
    });
    wrapper.append(clear);
    return wrapper;
  }

  private renderSkillPalette(): HTMLElement | undefined {
    if (!this.isSlashActive()) return undefined;
    const panel = createElement("div", "siyuan-addon-skill-palette");
    if (this.skillLoadStatus === "loading") {
      panel.append(createElement("div", "siyuan-addon-skill-palette__empty", "正在读取 LLM-Wiki/skills..."));
      return panel;
    }
    if (this.skillLoadStatus === "error") {
      panel.append(createElement("div", "siyuan-addon-skill-palette__empty", this.skillLoadError || "读取 skill 列表失败"));
      return panel;
    }
    const items = this.filteredSkills();
    if (items.length === 0) {
      panel.append(createElement("div", "siyuan-addon-skill-palette__empty", "没有匹配的 skill"));
      return panel;
    }
    for (const [index, item] of items.entries()) {
      const row = createElement(
        "button",
        `siyuan-addon-skill-palette__item${index === this.activeSkillIndex ? " siyuan-addon-skill-palette__item--active" : ""}`,
      );
      row.type = "button";
      row.addEventListener("click", () => this.selectSkill(item));
      row.append(createElement("span", "siyuan-addon-skill-palette__name", item.name));
      row.append(createElement("span", "siyuan-addon-skill-palette__summary", item.summary));
      panel.append(row);
    }
    return panel;
  }

  private handleSkillPaletteKeydown(event: KeyboardEvent, session: ChatSession): boolean {
    if (!this.isSlashActive() || event.isComposing) return false;
    const items = this.filteredSkills();
    if (event.key === "Escape") {
      event.preventDefault();
      this.draft = "";
      this.activeSkillIndex = 0;
      this.focusComposerAfterRender = true;
      this.render(session);
      return true;
    }
    if (!items.length) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.activeSkillIndex = (this.activeSkillIndex + 1) % items.length;
      this.focusComposerAfterRender = true;
      this.render(session);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeSkillIndex = (this.activeSkillIndex - 1 + items.length) % items.length;
      this.focusComposerAfterRender = true;
      this.render(session);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.selectSkill(items[this.activeSkillIndex]);
      return true;
    }
    return false;
  }

  private selectSkill(skill: SkillIndexItem): void {
    this.selectedSkill = skill;
    this.draft = "";
    this.activeSkillIndex = 0;
    this.focusComposerAfterRender = true;
    this.render(this.options.chatService.snapshot());
  }

  private filteredSkills(): SkillIndexItem[] {
    const query = this.draft.trim().replace(/^\//, "").trim().toLowerCase();
    const items = query
      ? this.skillItems.filter((item) => `${item.name} ${item.summary}`.toLowerCase().includes(query))
      : this.skillItems;
    return items.slice(0, 8);
  }

  private isSlashActive(): boolean {
    return !this.selectedSkill && this.draft.trimStart().startsWith("/");
  }

  private async ensureSkillsLoaded(): Promise<void> {
    if (this.skillLoadStatus === "ready" || this.skillLoadStatus === "loading") return this.skillLoadPromise;
    this.skillLoadStatus = "loading";
    this.skillLoadError = "";
    this.skillLoadPromise = this.options.skillIndexReader
      .listSkills()
      .then((items) => {
        this.skillItems = items;
        this.skillLoadStatus = "ready";
      })
      .catch((error) => {
        this.skillItems = [];
        this.skillLoadStatus = "error";
        this.skillLoadError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.skillLoadPromise = undefined;
        if (this.isSlashActive()) this.focusComposerAfterRender = true;
        this.render(this.options.chatService.snapshot());
      });
    return this.skillLoadPromise;
  }

  private metaText(role: string, status: string): string {
    const roleText = role === "user" ? "你" : role === "tool-status" ? "工具" : "AI";
    const statusText =
      status === "streaming"
        ? "生成中"
        : status === "error"
          ? "失败"
          : status === "stopped"
            ? "已停止"
            : status === "waiting-continue"
              ? "等待继续"
              : "";
    return [roleText, statusText].filter(Boolean).join(" · ");
  }

  private renderReActTrace(message: ChatMessage): HTMLElement | undefined {
    const trace = message.reactTrace;
    if (!trace?.steps.length) return undefined;
    const details = document.createElement("details");
    details.className = "siyuan-addon-react";
    details.open = this.traceOpenState.get(message.id) ?? !trace.collapsed;
    details.addEventListener("toggle", () => {
      this.traceOpenState.set(message.id, details.open);
    });
    const summary = createElement("summary", "siyuan-addon-react__summary", `思考过程 · ${trace.steps.length} 轮`);
    details.append(summary);
    const list = createElement("div", "siyuan-addon-react__steps");
    for (const step of trace.steps) {
      const item = createElement("div", "siyuan-addon-react__step");
      item.append(createElement("div", "siyuan-addon-react__round", `第 ${step.round} 轮`));
      item.append(this.renderTraceLine("Thought", step.thought));
      for (const action of step.actions) {
        item.append(this.renderTraceLine("Action", `${action.toolName} ${action.argumentsSummary}`));
      }
      for (const observation of step.observations) {
        item.append(this.renderTraceLine("Observation", observation.summary));
      }
      list.append(item);
    }
    details.append(list);
    return details;
  }

  private renderReferences(message: ChatMessage): HTMLElement | undefined {
    if (!message.references?.length) return undefined;
    const wrapper = createElement("div", "siyuan-addon-references");
    wrapper.append(createElement("div", "siyuan-addon-references__title", "References"));
    const list = createElement("ol", "siyuan-addon-references__list");
    for (const reference of message.references) {
      const item = createElement("li", "siyuan-addon-references__item");
      const title = createElement("button", "siyuan-addon-references__name", reference.title) as HTMLButtonElement;
      title.type = "button";
      title.addEventListener("click", () => {
        void this.options.documentOpener.open({ title: reference.title, path: reference.path });
      });
      const source = createElement("span", "siyuan-addon-references__source", reference.sourceLabel || "Reference");
      const path = createElement("button", "siyuan-addon-references__path", reference.path) as HTMLButtonElement;
      path.type = "button";
      path.addEventListener("click", () => {
        void this.options.documentOpener.open({ title: reference.title, path: reference.path });
      });
      item.append(title, source, path);
      list.append(item);
    }
    wrapper.append(list);
    return wrapper;
  }

  private renderTraceLine(label: string, value: string): HTMLElement {
    const line = createElement("div", "siyuan-addon-react__line");
    line.append(createElement("div", "siyuan-addon-react__label", `${label}：`));
    const body = createElement("div", "siyuan-addon-react__body");
    renderMarkdown(body, value, { onOpenDocument: (target) => void this.options.documentOpener.open(target) });
    line.append(body);
    return line;
  }

  private copyableMessageText(message: ChatMessage): string {
    if (message.role !== "assistant" || !message.reactTrace?.steps.length) return message.content;
    const lines = ["思考过程"];
    for (const step of message.reactTrace.steps) {
      lines.push(`第 ${step.round} 轮`);
      lines.push(`Thought：${step.thought}`);
      for (const action of step.actions) {
        lines.push(`Action：${action.toolName} ${action.argumentsSummary}`);
      }
      for (const observation of step.observations) {
        lines.push(`Observation：${observation.summary}`);
      }
      lines.push("");
    }
    lines.push("最终回答");
    lines.push(message.content);
    if (message.pauseHint) lines.push("", message.pauseHint);
    return lines.join("\n").trim();
  }

  private async copyText(value: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

}
