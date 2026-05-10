import { Plugin } from "siyuan";
import "./styles.css";
import { ChatDock } from "./ui/chat-dock";
import { SettingsStore } from "./services/settings-store";
import { ChatService } from "./services/chat-service";
import { McpService } from "./services/mcp-service";
import { getActiveProfile } from "./services/llm-profile-service";

const DOCK_TYPE = "siyuan-addon-ai-chat";
const SIYUAN_DOCK_TYPE = "siyuan-addonsiyuan-addon-ai-chat";

export default class SiyuanAddonPlugin extends Plugin {
  private settingsStore?: SettingsStore;
  private mcpService?: McpService;
  private chatService?: ChatService;
  private chatDock?: ChatDock;

  onload(): void {
    this.addIcons(`<symbol id="iconSiyuanAddonAI" viewBox="0 0 32 32">
<path d="M16 3c7.18 0 13 5.15 13 11.5 0 3.32-1.6 6.3-4.15 8.4.24 1.5.74 3.06 1.5 4.68.2.43-.24.88-.68.7-2.08-.84-3.88-1.78-5.4-2.82-1.34.35-2.77.54-4.27.54-7.18 0-13-5.15-13-11.5S8.82 3 16 3Zm-5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"></path>
</symbol>`);
    this.settingsStore = new SettingsStore(this);
    this.mcpService = new McpService();
    this.chatService = new ChatService({
      mcpService: this.mcpService,
      getActiveProfile: () => {
        const settings = this.settingsStore?.get();
        return settings ? getActiveProfile(settings.llmProfiles, settings.activeProfileId) : undefined;
      },
    });
    this.chatDock = new ChatDock({
      chatService: this.chatService,
      settingsStore: this.settingsStore,
      mcpService: this.mcpService,
    });
    this.registerDock();
    void this.settingsStore.load();
  }

  onunload(): void {
    this.chatDock?.unmount();
    void this.mcpService?.closeAll();
  }

  private registerDock(): void {
    this.dedupeDockLayout();
    const plugin = this;
    this.addDock({
      config: {
        position: "RightBottom",
        size: { width: 360, height: 0 },
        icon: "iconSiyuanAddonAI",
        title: "AI Chat",
      },
      data: {},
      type: DOCK_TYPE,
      init: function (this: { element: Element }, dock?: { element: Element }) {
        plugin.chatDock?.mount((dock?.element || this.element) as HTMLElement);
      },
      update: function (this: { element: Element }, dock?: { element: Element }) {
        plugin.chatDock?.mount((dock?.element || this.element) as HTMLElement);
      },
      destroy: () => {
        this.chatDock?.unmount();
      },
    });
    this.dedupeDockLayout();
    window.setTimeout(() => this.dedupeDockLayout(), 0);
  }

  private dedupeDockLayout(): void {
    const siyuanWindow = window as typeof window & {
      siyuan?: { config?: { uiLayout?: unknown } };
    };
    const layout = siyuanWindow.siyuan?.config?.uiLayout;
    if (!layout) return;
    let seen = false;
    const visit = (value: unknown): void => {
      if (!value) return;
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          const item = value[index] as { type?: string } | unknown;
          if (item && typeof item === "object" && (item as { type?: string }).type === SIYUAN_DOCK_TYPE) {
            if (seen) {
              value.splice(index, 1);
              index -= 1;
            } else {
              seen = true;
            }
            continue;
          }
          visit(item);
        }
        return;
      }
      if (typeof value !== "object") return;
      Object.values(value as Record<string, unknown>).forEach(visit);
    };
    visit(layout);
  }
}
