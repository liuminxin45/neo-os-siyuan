import type { ChatService } from "../services/chat-service";
import type { SettingsStore } from "../services/settings-store";
import type { ChatMessage, ChatSession } from "../models/chat";
import { createElement } from "./render";
import { SettingsModal } from "./settings-modal";
import type { McpService } from "../services/mcp-service";

interface ChatDockOptions {
  chatService: ChatService;
  settingsStore: SettingsStore;
  mcpService: McpService;
}

export class ChatDock {
  private root?: HTMLElement;
  private draft = "";
  private unsubscribe?: () => void;
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
    this.root.innerHTML = "";
    const shell = createElement("div", "siyuan-addon-chat");
    const header = createElement("header", "siyuan-addon-chat__header");
    const title = createElement("div", "siyuan-addon-chat__title", "AI Chat");
    const settings = createElement("button", "siyuan-addon-icon-button", "设置");
    settings.addEventListener("click", () => this.settingsModal.open());
    header.append(title, settings);

    const messages = createElement("div", "siyuan-addon-chat__messages");
    if (session.messages.length === 0) {
      const empty = createElement("div", "siyuan-addon-empty");
      const active = this.options.settingsStore.get().activeProfileId;
      empty.textContent = active ? "输入问题开始聊天。" : "请先在设置中添加 LLM 配置。";
      messages.append(empty);
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
      const content = createElement("div", "siyuan-addon-message__content", message.content);
      item.append(meta, content);
      const trace = this.renderReActTrace(message);
      if (trace) item.append(trace);
      if (message.pauseHint) {
        item.append(createElement("div", "siyuan-addon-message__pause", message.pauseHint));
      }
      messages.append(item);
    });

    const canContinue = Boolean(session.continuation && !session.isGenerating && !this.draft.trim());
    const form = createElement("div", "siyuan-addon-composer");
    const textarea = document.createElement("textarea");
    textarea.className = "b3-text-field siyuan-addon-composer__input";
    textarea.placeholder = "输入消息，Enter 发送，Shift+Enter 换行";
    textarea.value = this.draft;
    textarea.disabled = session.isGenerating;
    textarea.addEventListener("input", () => {
      this.draft = textarea.value;
    });
    textarea.addEventListener("keydown", (event) => {
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
    form.append(textarea, actions);
    shell.append(header, messages, form);
    this.root.append(shell);
    messages.scrollTop = messages.scrollHeight;
  }

  private send(): void {
    const value = this.draft;
    this.draft = "";
    void this.options.chatService.send(value);
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
    details.open = !trace.collapsed;
    const summary = createElement("summary", "siyuan-addon-react__summary", `思考过程 · ${trace.steps.length} 轮`);
    details.append(summary);
    const list = createElement("div", "siyuan-addon-react__steps");
    for (const step of trace.steps) {
      const item = createElement("div", "siyuan-addon-react__step");
      item.append(createElement("div", "siyuan-addon-react__round", `第 ${step.round} 轮`));
      item.append(createElement("div", "siyuan-addon-react__line", `Thought：${step.thought}`));
      for (const action of step.actions) {
        item.append(createElement("div", "siyuan-addon-react__line", `Action：${action.toolName} ${action.argumentsSummary}`));
      }
      for (const observation of step.observations) {
        item.append(createElement("div", "siyuan-addon-react__line", `Observation：${observation.summary}`));
      }
      list.append(item);
    }
    details.append(list);
    return details;
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
