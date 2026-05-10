import type { ChatService } from "../services/chat-service";
import type { SettingsStore } from "../services/settings-store";
import type { ChatSession } from "../models/chat";
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
      const meta = createElement("div", "siyuan-addon-message__meta", this.metaText(message.role, message.status));
      const content = createElement("div", "siyuan-addon-message__content", message.content);
      item.append(meta, content);
      messages.append(item);
    });

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
        this.send();
      }
    });
    const actions = createElement("div", "siyuan-addon-composer__actions");
    const clear = createElement("button", "b3-button b3-button--outline", "清空");
    clear.addEventListener("click", () => {
      this.draft = "";
      this.options.chatService.clear();
    });
    const send = createElement("button", "b3-button", session.isGenerating ? "生成中" : "发送");
    send.disabled = session.isGenerating;
    send.addEventListener("click", () => this.send());
    const stop = createElement("button", "b3-button b3-button--cancel", "停止");
    stop.dataset.siyuanAddonAction = "stop";
    stop.disabled = !session.isGenerating;
    stop.addEventListener("click", () => this.options.chatService.stop());
    actions.append(clear, stop, send);
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
    const statusText = status === "streaming" ? "生成中" : status === "error" ? "失败" : status === "stopped" ? "已停止" : "";
    return [roleText, statusText].filter(Boolean).join(" · ");
  }
}
