import type { ChatListener, ChatMessage, ChatSession } from "../models/chat";
import type { LlmProfile } from "../models/llm";
import type { McpTool, McpToolCall } from "../models/mcp";
import { DEFAULT_MAX_MEMORY_TURNS, MAX_MEMORY_TURN_OPTIONS } from "../models/settings";
import type { SkillIndexItem } from "../models/skill";
import { createId, nowIso } from "../utils/ids";
import { safeErrorText } from "../utils/masks";
import type { McpService } from "./mcp-service";
import { AgentRuntime } from "./agent-runtime";
import { DEFAULT_AGENT_MODE, REACT_PAUSE_MESSAGE, type AgentMode, type ReActStep } from "../models/agent";

export interface ChatServiceOptions {
  getActiveProfile: () => LlmProfile | undefined;
  getAgentMode?: () => AgentMode | undefined;
  getMaxMemoryTurns?: () => number | undefined;
  mcpService: McpService;
}

export interface ChatSendOptions {
  skill?: SkillIndexItem;
}

const emptySession = (): ChatSession => ({
  messages: [],
  toolCalls: [],
  isGenerating: false,
  generationId: undefined,
  agentMode: DEFAULT_AGENT_MODE,
  continuation: undefined,
});

const looksLikeMcpRequest = (prompt: string): boolean =>
  /\bmcp\b/i.test(prompt) || /工具|思源|笔记本|笔记|文档|数据库|块|标签|文件|搜索|遍历|读取|查询|当前工作区/.test(prompt);

const isMemoryUser = (message: ChatMessage | undefined): message is ChatMessage =>
  message?.role === "user" && message.status === "complete" && message.content.trim().length > 0;

const isMemoryAssistant = (message: ChatMessage | undefined): message is ChatMessage =>
  message?.role === "assistant" && message.status === "complete" && message.content.trim().length > 0;

const toMemoryMessage = (message: ChatMessage): ChatMessage => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt,
  status: "complete",
});

export class ChatService {
  private session: ChatSession = emptySession();
  private listeners = new Set<ChatListener>();
  private abortController?: AbortController;
  private readonly agentRuntime = new AgentRuntime();

  constructor(private readonly options: ChatServiceOptions) {}

  subscribe(listener: ChatListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ChatSession {
    return structuredClone(this.session);
  }

  refresh(): void {
    this.emit();
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
      continuation: undefined,
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

  async send(content: string, options: ChatSendOptions = {}): Promise<void> {
    const prompt = this.formatPrompt(content, options.skill);
    if (!prompt || this.session.isGenerating) return;
    if (this.session.continuation) {
      this.abandonContinuation();
    }
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
    const memoryMessages = this.memoryMessages();
    const nextMessages = [...this.session.messages, userMessage, assistantMessage];
    this.session = {
      ...this.session,
      messages: nextMessages,
      isGenerating: true,
      generationId,
      agentMode: this.options.getAgentMode?.() || DEFAULT_AGENT_MODE,
      continuation: undefined,
    };
    this.emit();

    try {
      const tools = this.options.mcpService.getTools();
      if (tools.length === 0 && looksLikeMcpRequest(prompt)) {
        this.appendAssistantChunk(assistantMessage.id, "当前没有可用的 MCP 工具，请先在设置中连接并发现 MCP 工具。", generationId);
        this.finishAssistant(assistantMessage.id, generationId);
        return;
      }
      const result = await this.agentRuntime.run({
        mode: this.session.agentMode,
        profile,
        messages: [...memoryMessages, userMessage, assistantMessage],
        tools,
        signal: this.abortController.signal,
      }, this.agentHandlers(assistantMessage.id, generationId));

      if (result.status === "paused") {
        this.pauseAssistant(assistantMessage.id, generationId, {
          assistantMessageId: assistantMessage.id,
          toolResults: result.toolResults,
          completedRounds: result.completedRounds,
          reactHistory: result.reactHistory,
        });
        return;
      }

      if (!result.content && result.toolResults.length > 0) {
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

  async continue(): Promise<void> {
    if (this.session.isGenerating || !this.session.continuation) return;
    const profile = this.options.getActiveProfile();
    if (!profile) {
      this.appendAssistantError("请先在设置中添加并选择 LLM 配置");
      return;
    }
    const continuation = this.session.continuation;
    const runtimeMessages = this.continuationRuntimeMessages(continuation.assistantMessageId);
    const generationId = createId("gen");
    this.abortController = new AbortController();
    this.session = {
      ...this.session,
      isGenerating: true,
      generationId,
      continuation: undefined,
      messages: this.session.messages.map((message) =>
        message.id === continuation.assistantMessageId ? { ...message, status: "streaming", pauseHint: undefined } : message,
      ),
    };
    this.emit();
    try {
      const result = await this.agentRuntime.run({
        mode: this.session.agentMode,
        profile,
        messages: runtimeMessages,
        tools: this.options.mcpService.getTools(),
        signal: this.abortController.signal,
        continuation,
      }, this.agentHandlers(continuation.assistantMessageId, generationId));
      if (result.status === "paused") {
        this.pauseAssistant(continuation.assistantMessageId, generationId, {
          assistantMessageId: continuation.assistantMessageId,
          toolResults: result.toolResults,
          completedRounds: result.completedRounds,
          reactHistory: result.reactHistory,
        });
        return;
      }
      this.finishAssistant(continuation.assistantMessageId, generationId);
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        this.stop();
        return;
      }
      this.failAssistant(continuation.assistantMessageId, safeErrorText(error), generationId);
    } finally {
      if (this.session.generationId === generationId) {
        this.session = { ...this.session, isGenerating: false };
        this.emit();
      }
    }
  }

  private agentHandlers(messageId: string, generationId: string) {
    return {
      onText: (chunk: string) => this.appendAssistantChunk(messageId, chunk, generationId),
      onStep: (step: ReActStep) => this.appendReActStep(messageId, step, generationId),
      onToolStart: (tool: McpTool, args: Record<string, unknown>, requestId?: string) =>
        this.startToolCall(tool, args, requestId, generationId),
      onToolFinish: (call: McpToolCall) => this.updateToolCall(call),
      callTool: (tool: McpTool, args: Record<string, unknown>) =>
        this.options.mcpService.callTool(tool, args, this.session.generationId || ""),
    };
  }

  private formatPrompt(content: string, skill?: SkillIndexItem): string {
    const userGoal = content.trim();
    if (!skill) return userGoal;
    return [
      `用户目标：${userGoal || "用户尚未提供具体目标，请先追问澄清。"}`,
      `已选 skill：${skill.name}`,
      `skill 简述：${skill.summary || "暂无简述"}`,
      `skill 索引路径：${skill.sourcePath}`,
      "约束：除 skill 名称和简述外，其它信息必须通过 MCP 获取或写入。你必须先理解用户真实意图；目标不清楚时先追问；需要读取完整 skill、工作区内容、/runs 运行记录或写入任何内容时，必须调用可用 MCP 工具完成，不要假设插件已经读取过这些内容。只有观察到成功的 MCP 写入类调用后，才可以说已经记录、保存或写入。",
    ].join("\n");
  }

  private maxMemoryTurns(): number {
    const value = this.options.getMaxMemoryTurns?.();
    return typeof value === "number" && MAX_MEMORY_TURN_OPTIONS.includes(value as 5 | 10 | 20 | 30)
      ? value
      : DEFAULT_MAX_MEMORY_TURNS;
  }

  private memoryMessages(source = this.session.messages): ChatMessage[] {
    const pairs: ChatMessage[][] = [];
    for (let index = 0; index < source.length - 1; index += 1) {
      const user = source[index];
      const assistant = source[index + 1];
      if (!isMemoryUser(user) || !isMemoryAssistant(assistant)) continue;
      pairs.push([toMemoryMessage(user), toMemoryMessage(assistant)]);
      index += 1;
    }
    return pairs.slice(-this.maxMemoryTurns()).flat();
  }

  private continuationRuntimeMessages(assistantMessageId: string): ChatMessage[] {
    const assistantIndex = this.session.messages.findIndex((message) => message.id === assistantMessageId);
    if (assistantIndex < 1) return this.memoryMessages();
    const userMessage = this.session.messages[assistantIndex - 1];
    const assistantMessage = this.session.messages[assistantIndex];
    const priorMemory = this.memoryMessages(this.session.messages.slice(0, assistantIndex - 1));
    return isMemoryUser(userMessage) ? [...priorMemory, toMemoryMessage(userMessage), assistantMessage] : [...priorMemory, assistantMessage];
  }

  private abandonContinuation(): void {
    const continuation = this.session.continuation;
    if (!continuation) return;
    const removeMessageIds = new Set<string>([continuation.assistantMessageId]);
    const assistantIndex = this.session.messages.findIndex((message) => message.id === continuation.assistantMessageId);
    if (assistantIndex > 0 && this.session.messages[assistantIndex - 1]?.role === "user") {
      removeMessageIds.add(this.session.messages[assistantIndex - 1].id);
    }
    const removeToolCallIds = new Set(continuation.toolResults.map((call) => call.id));
    this.session = {
      ...this.session,
      continuation: undefined,
      messages: this.session.messages.filter((message) => !removeMessageIds.has(message.id)),
      toolCalls: this.session.toolCalls.filter((call) => !removeToolCallIds.has(call.id)),
    };
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
        message.id === messageId
          ? {
              ...message,
              status: "complete",
              content: message.content || "已完成。",
              pauseHint: undefined,
              reactTrace: message.reactTrace ? { ...message.reactTrace, waitingContinuation: false, pauseReason: undefined } : undefined,
            }
          : message,
      ),
    };
    this.emit();
  }

  private pauseAssistant(messageId: string, generationId: string, continuation: ChatSession["continuation"]): void {
    if (this.session.generationId !== generationId) return;
    this.session = {
      ...this.session,
      isGenerating: false,
      continuation,
      messages: this.session.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              status: "waiting-continue",
              pauseHint: REACT_PAUSE_MESSAGE,
              reactTrace: {
                steps: message.reactTrace?.steps || [],
                collapsed: message.reactTrace?.collapsed ?? true,
                waitingContinuation: true,
                pauseReason: REACT_PAUSE_MESSAGE,
              },
            }
          : message,
      ),
    };
    this.emit();
  }

  private appendReActStep(messageId: string, step: ReActStep, generationId: string): void {
    if (this.session.generationId !== generationId) return;
    this.session = {
      ...this.session,
      messages: this.session.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              reactTrace: {
                steps: [...(message.reactTrace?.steps || []), step],
                collapsed: message.reactTrace?.collapsed ?? true,
                waitingContinuation: false,
              },
            }
          : message,
      ),
    };
    this.emit();
  }

  private startToolCall(tool: McpTool, args: Record<string, unknown>, requestId: string | undefined, generationId: string): McpToolCall {
    const pendingCall: McpToolCall = {
      id: requestId || createId("tool"),
      serverId: tool.serverId,
      toolName: tool.name,
      llmName: tool.llmName,
      status: "running",
      startedAt: nowIso(),
      argumentsSummary: JSON.stringify(args),
    };
    this.session = {
      ...this.session,
      toolCalls: [...this.session.toolCalls, pendingCall],
    };
    this.emit();
    return this.session.generationId === generationId ? pendingCall : { ...pendingCall, status: "stopped" };
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
    };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
