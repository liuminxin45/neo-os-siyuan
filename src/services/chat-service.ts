import type { ChatListener, ChatMessage, ChatSession } from "../models/chat";
import type { LlmProfile } from "../models/llm";
import type { McpToolCall } from "../models/mcp";
import { streamChatCompletion } from "../adapters/llm-chat-completions";
import { createId, nowIso } from "../utils/ids";
import { safeErrorText } from "../utils/masks";
import type { McpService } from "./mcp-service";

export interface ChatServiceOptions {
  getActiveProfile: () => LlmProfile | undefined;
  mcpService: McpService;
}

const emptySession = (): ChatSession => ({
  messages: [],
  toolCalls: [],
  isGenerating: false,
  generationId: undefined,
});

export class ChatService {
  private session: ChatSession = emptySession();
  private listeners = new Set<ChatListener>();
  private abortController?: AbortController;

  constructor(private readonly options: ChatServiceOptions) {}

  subscribe(listener: ChatListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ChatSession {
    return structuredClone(this.session);
  }

  clear(): void {
    this.stop();
    this.session = emptySession();
    this.emit();
  }

  stop(): void {
    if (!this.session.isGenerating) return;
    this.abortController?.abort();
    const stoppedGeneration = this.session.generationId ? `${this.session.generationId}:stopped` : undefined;
    this.session = {
      ...this.session,
      isGenerating: false,
      generationId: stoppedGeneration,
      messages: this.session.messages.map((message) =>
        message.status === "streaming" || message.status === "pending" ? { ...message, status: "stopped" } : message,
      ),
      toolCalls: this.session.toolCalls.map((call) =>
        call.status === "pending" || call.status === "running"
          ? { ...call, status: "stopped", finishedAt: nowIso() }
          : call,
      ),
    };
    this.emit();
  }

  async send(content: string): Promise<void> {
    const prompt = content.trim();
    if (!prompt || this.session.isGenerating) return;
    const profile = this.options.getActiveProfile();
    if (!profile) {
      this.appendAssistantError("请先在设置中添加并选择 LLM 配置");
      return;
    }

    const generationId = createId("gen");
    const userMessage: ChatMessage = {
      id: createId("msg"),
      role: "user",
      content: prompt,
      createdAt: nowIso(),
      status: "complete",
    };
    const assistantMessage: ChatMessage = {
      id: createId("msg"),
      role: "assistant",
      content: "",
      createdAt: nowIso(),
      status: "streaming",
    };
    this.abortController = new AbortController();
    this.session = {
      ...this.session,
      messages: [...this.session.messages, userMessage, assistantMessage],
      isGenerating: true,
      generationId,
    };
    this.emit();

    try {
      const tools = this.options.mcpService.getTools();
      let latest = await streamChatCompletion(profile, this.session.messages, {
        signal: this.abortController.signal,
        tools,
        onText: (chunk) => this.appendAssistantChunk(assistantMessage.id, chunk, generationId),
      });

      const toolResults: McpToolCall[] = [];
      const maxToolRounds = 4;
      for (let round = 0; round < maxToolRounds && latest.toolRequests.length > 0; round += 1) {
        const roundResults: McpToolCall[] = [];
        for (const request of latest.toolRequests) {
          if (this.session.generationId !== generationId || !this.session.isGenerating) break;
          const tool = tools.find((candidate) => candidate.llmName === request.name);
          if (!tool) continue;
          const pendingCall: McpToolCall = {
            id: request.id || createId("tool"),
            serverId: tool.serverId,
            toolName: tool.name,
            llmName: tool.llmName,
            status: "running",
            startedAt: nowIso(),
            argumentsSummary: JSON.stringify(request.arguments),
          };
          this.session.toolCalls = [...this.session.toolCalls, pendingCall];
          this.session.messages = [
            ...this.session.messages,
            {
              id: createId("msg"),
              role: "tool-status",
              content: `${tool.name}：调用中`,
              createdAt: nowIso(),
              status: "pending",
              toolCallId: pendingCall.id,
            },
          ];
          this.emit();
          const result = await this.options.mcpService.callTool(tool, request.arguments, this.session.generationId || "");
          const matchedResult = { ...result, id: pendingCall.id };
          const finalResult =
            this.session.generationId === generationId ? matchedResult : { ...matchedResult, status: "stopped" as const };
          roundResults.push(finalResult);
          this.updateToolCall(finalResult);
        }
        if (roundResults.length === 0 || this.session.generationId !== generationId || !this.session.isGenerating) break;
        toolResults.push(...roundResults);
        latest = await streamChatCompletion(profile, this.session.messages, {
          signal: this.abortController.signal,
          tools,
          toolResults,
          onText: (chunk) => this.appendAssistantChunk(assistantMessage.id, chunk, generationId),
        });
      }

      if (!latest.content && toolResults.length > 0) {
        this.appendAssistantChunk(assistantMessage.id, "工具调用已完成。", generationId);
      }
      this.finishAssistant(assistantMessage.id, generationId);
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        this.stop();
        return;
      }
      this.failAssistant(assistantMessage.id, safeErrorText(error), generationId);
    } finally {
      if (this.session.generationId === generationId) {
        this.session = { ...this.session, isGenerating: false };
        this.emit();
      }
    }
  }

  private appendAssistantChunk(messageId: string, chunk: string, generationId: string): void {
    if (this.session.generationId !== generationId) return;
    this.session = {
      ...this.session,
      messages: this.session.messages.map((message) =>
        message.id === messageId ? { ...message, content: message.content + chunk, status: "streaming" } : message,
      ),
    };
    this.emit();
  }

  private finishAssistant(messageId: string, generationId: string): void {
    if (this.session.generationId !== generationId) return;
    this.session = {
      ...this.session,
      messages: this.session.messages.map((message) =>
        message.id === messageId ? { ...message, status: "complete", content: message.content || "已完成。" } : message,
      ),
    };
    this.emit();
  }

  private failAssistant(messageId: string, error: string, generationId: string): void {
    if (this.session.generationId !== generationId) return;
    this.session = {
      ...this.session,
      isGenerating: false,
      messages: this.session.messages.map((message) =>
        message.id === messageId ? { ...message, status: "error", content: error } : message,
      ),
    };
    this.emit();
  }

  private appendAssistantError(error: string): void {
    this.session = {
      ...this.session,
      messages: [
        ...this.session.messages,
        { id: createId("msg"), role: "assistant", content: error, createdAt: nowIso(), status: "error" },
      ],
    };
    this.emit();
  }

  private updateToolCall(call: McpToolCall): void {
    this.session = {
      ...this.session,
      toolCalls: this.session.toolCalls.map((item) => (item.id === call.id ? call : item)),
      messages: this.session.messages.map((message) =>
        message.toolCallId === call.id
          ? { ...message, content: `${call.toolName}：${this.toolStatusText(call.status)}`, status: call.status === "error" ? "error" : "complete" }
          : message,
      ),
    };
    this.emit();
  }

  private toolStatusText(status: McpToolCall["status"]): string {
    if (status === "success") return "完成";
    if (status === "error") return "失败";
    if (status === "stopped") return "已停止";
    return "调用中";
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
