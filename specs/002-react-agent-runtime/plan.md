# Implementation Plan: ReAct Agent Runtime

**Feature**: `002-react-agent-runtime`
**Spec**: `specs/002-react-agent-runtime/spec.md`
**Status**: Implemented

## Summary

Introduce a unified Agent Runtime layer for AI chat. The default and only implemented mode is ReAct. DeepSeek, OpenAI-compatible providers, and Kimi CodingPlan all use the same runtime; provider adapters remain responsible for wire protocol differences only.

The runtime coordinates ReAct trace generation, MCP tool selection and execution, pause/continue behavior, and stop handling. Future Reflection and Plan-and-Execute modes are reserved in types and settings but are not exposed in UI or implemented.

## Technical Context

**Runtime**: Siyuan plugin frontend runtime, TypeScript, Vite
**Existing LLM Layer**: `src/adapters/llm-chat-completions.ts`
**Existing Tool Layer**: `src/services/mcp-service.ts`
**Existing Chat Orchestration**: `src/services/chat-service.ts`
**Existing UI**: `src/ui/chat-dock.ts`

## Architecture

### Agent Runtime Layer

Add an Agent Runtime layer between `ChatService` and provider adapters.

`ChatService` owns chat session state, send/stop/continue/clear actions, and listener updates. It delegates assistant turn execution to Agent Runtime.

`AgentRuntime` resolves agent mode, falls back to ReAct, runs the ReAct loop, tracks ReAct trace, executes MCP requests through `McpService`, pauses every 6 unfinished rounds, and resumes from stored continuation state.

Provider adapters send provider-specific requests, parse provider-specific streaming/tool-call formats, and return normalized model output to Agent Runtime.

### ReAct Runtime

The ReAct runtime runs in segments of up to 10 rounds. Each round may contain Thought, Action, Observation, and Final.

If no tool is needed, the runtime may produce Thought and Final. If 10 rounds complete without Final, the runtime pauses and stores continuation state.

### Continuation Flow

When paused, chat session records waiting state, the latest AI message shows "已超过默认思考最大轮次，是否继续", and the composer primary button becomes red "继续".

Clicking continue resumes the same assistant message and ReAct trace for another 10-round segment. Stop ends the turn and clears continuation. Sending a new prompt abandons pending continuation.

### Agent Mode Reservation

Add `AgentMode = "react" | "reflection" | "plan-and-execute"` and `agentMode?: AgentMode` in plugin settings. Default is `react`. No UI switch is added. Unsupported modes fall back to `react`.

## Data Flow

### New Message

1. User sends prompt.
2. `ChatService` creates user and assistant messages.
3. `ChatService` calls Agent Runtime with active profile, messages, MCP tools, and session state.
4. ReAct Runtime starts a 10-round segment.
5. Runtime calls provider adapter and receives normalized output/tool requests.
6. Runtime executes MCP tools when requested.
7. Runtime appends Action and Observation records.
8. Runtime repeats until Final, stop, error, or pause.
9. UI updates after visible trace or message state changes.

### Continue

1. User clicks red "继续".
2. `ChatService` calls Agent Runtime with stored continuation state.
3. Runtime resumes previous trace and message context.
4. Runtime runs another 10-round segment.
5. Result is Final, pause again, stop, or error.

## UI Plan

AI messages show a collapsed "思考过程" block by default. Expanded content lists ReAct rounds with Thought, Action, and Observation. Final answer remains in the normal assistant message body. Standalone tool status/result bubbles are not rendered in the chat list.

Composer primary button states:

- idle: "发送"
- generating: "停止"
- waiting continuation: red "继续"

Pause hint shown in latest AI message: "已超过默认思考最大轮次，是否继续".

## Error Handling

- No available MCP tools for workspace-data intent: show a clear assistant message; do not let the model fake tool calls.
- Invalid ReAct output: attempt one repair inside the current segment; if still invalid, show a recoverable assistant error.
- Tool failure: record failure as Observation and allow the runtime to continue.
- Stop during LLM streaming: abort request and mark turn stopped.
- Stop during MCP call: mark the visible tool call stopped and ignore late results.
- Continue after stop: not allowed.
- New user message while waiting continuation: abandon continuation state.

## Testing Strategy

- AgentMode default and fallback.
- ReAct trace structure with Thought, Action, Observation, and Final.
- 10-round pause and continuation resume.
- Stop clears continuation.
- No-tools guard triggers for workspace-data intent.
- DeepSeek/OpenAI-compatible tool calls still normalize correctly.
- Kimi Anthropic tool_use still normalizes correctly.
- Pseudo XML fallback cannot bypass real tool schema matching.
- Manual UI validation for collapsed trace, red continue, stop, and new-message abandonment.

## Constraints

- Do not persist chat history or ReAct trace.
- Do not expose Agent mode switch in UI.
- Do not implement Reflection or Plan-and-Execute.
- Do not show full raw MCP results in Observation.
- Do not show standalone tool result/status bubbles; use ReAct trace instead.
