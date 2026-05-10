# Feature Specification: ReAct Agent Runtime for AI Chat

**Feature Branch**: `002-react-agent-runtime`
**Created**: 2026-05-10
**Status**: Implemented
**Input**: User description: "AI 对话适配 ReAct Agent 模式，默认始终启动；预留 Reflection、Plan-and-Execute 等模式接入/切换能力，但本期不实现。"

## Clarification Summary

- AI chat defaults to ReAct Agent mode for all providers.
- DeepSeek, OpenAI-compatible providers, and Kimi CodingPlan use the same Agent Runtime.
- ReAct thinking is visible as a collapsible process block, default collapsed.
- The visible process includes Thought, Action, and Observation.
- Observation shows a summary only, not the full raw MCP result.
- Action shows tool name and argument summary without masking.
- ReAct pauses every 10 rounds if no final answer is produced.
- Continuing after a pause requires explicit user action and resumes from the interruption point.
- Agent mode switching is reserved in settings/model/runtime structure but no UI switch is shown in this version.
- Reflection and Plan-and-Execute are reserved but not implemented.
- ReAct trace is session-only and is cleared with chat history.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default ReAct Agent Chat (Priority: P1)

A user sends any message and the assistant processes it through the default ReAct Runtime. The assistant can think, decide whether tools are needed, call MCP tools, observe results, and then produce a final answer.

**Why this priority**: ReAct becomes the default orchestration model for every chat turn.

**Independent Test**: Configure a valid LLM profile, send a normal question and a workspace-data question, and verify both are handled by ReAct Runtime.

**Acceptance Scenarios**:

1. **Given** a valid active LLM profile, **When** the user sends a message, **Then** the assistant turn is handled by ReAct Runtime rather than a direct one-shot chat completion.
2. **Given** MCP tools are available, **When** the user asks for Siyuan workspace data without explicitly saying MCP, **Then** the assistant prioritizes tool selection from the available tool schemas.
3. **Given** the user asks a question that does not need workspace data, **When** ReAct determines no tool is needed, **Then** the assistant may answer with Thought and Final without calling MCP.

### User Story 2 - View Collapsed Thinking Process (Priority: P1)

A user can inspect the assistant's ReAct process without the chat becoming noisy by default.

**Why this priority**: The user explicitly wants visible COT-style ReAct process while preserving a compact chat surface.

**Independent Test**: Send a prompt that triggers multiple ReAct steps, confirm the AI message shows a collapsed "思考过程" block, then expand it.

**Acceptance Scenarios**:

1. **Given** a ReAct trace exists, **When** the assistant message is displayed, **Then** the "思考过程" block is collapsed by default.
2. **Given** the user expands "思考过程", **Then** each ReAct round shows Thought, Action, and Observation.
3. **Given** a tool returns a result, **When** Observation is shown, **Then** only a result summary is displayed.
4. **Given** a tool is called, **When** Action is shown, **Then** the UI displays the tool name and argument summary without masking arguments.

### User Story 3 - Manually Continue After Round Limit (Priority: P1)

When ReAct reaches the default thinking limit without a final answer, the system pauses and asks the user whether to continue.

**Why this priority**: Long-running agent loops need explicit user control and should resume from context rather than restart.

**Independent Test**: Use a test model or controlled prompt to exceed 6 ReAct rounds without Final, then continue and verify the same assistant message resumes.

**Acceptance Scenarios**:

1. **Given** ReAct has completed 10 rounds without Final, **When** the limit is reached, **Then** the assistant turn pauses.
2. **Then** the latest conversation area shows "已超过默认思考最大轮次，是否继续".
3. **Then** the composer primary button becomes a red highlighted "继续".
4. **Given** the assistant is waiting for continuation, **When** the user clicks "继续", **Then** ReAct resumes from the interrupted context.
5. **Given** another 10 rounds complete without Final after continuing, **Then** the assistant pauses again and requires another manual continue.
6. **Given** the user clicks stop, **Then** the current ReAct turn ends and cannot be continued.
7. **Given** the assistant is waiting for continuation, **When** the user sends a new prompt, **Then** the old continuation is abandoned and a new ReAct turn starts.

### User Story 4 - Reserve Agent Mode Extension (Priority: P2)

The system reserves room for future Agent modes without exposing unfinished controls.

**Why this priority**: Future Reflection and Plan-and-Execute support should not require rewriting the chat orchestration boundary.

**Independent Test**: Inspect settings/model/runtime behavior and confirm the default is react, unsupported modes fall back to react, and no mode switch appears in UI.

**Acceptance Scenarios**:

1. **Given** settings contain no agent mode, **When** the plugin runs, **Then** the effective mode is react.
2. **Given** settings contain an unimplemented mode, **When** runtime starts, **Then** it falls back to react.
3. **Given** the user opens settings, **Then** no Reflection or Plan-and-Execute switch is shown.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST use ReAct Runtime by default for AI chat.
- **FR-002**: The system MUST support visible ReAct trace records containing Thought, Action, Observation, and Final.
- **FR-003**: The assistant MUST prioritize available MCP tools when the user intent involves Siyuan workspace data, even if the user does not explicitly mention MCP.
- **FR-004**: The assistant MUST select MCP tools and arguments from tool name, description, and input schema.
- **FR-005**: The UI MUST show ReAct thinking in a collapsible "思考过程" block that is collapsed by default.
- **FR-006**: Observation MUST show result summaries only, not full raw MCP results.
- **FR-007**: Action MUST show tool name and argument summary without masking arguments.
- **FR-008**: The chat UI MUST NOT show standalone tool result/status bubbles; tool activity MUST appear in the ReAct trace.
- **FR-009**: The default continuous ReAct limit MUST be 10 rounds.
- **FR-010**: If 10 rounds complete without Final, the assistant MUST pause and wait for manual continuation.
- **FR-011**: Continuing MUST resume from the interrupted ReAct context instead of restarting.
- **FR-012**: The system MUST reserve AgentMode values `react`, `reflection`, and `plan-and-execute`.
- **FR-013**: The default AgentMode MUST be `react`.
- **FR-014**: The current version MUST NOT show an Agent mode switch in UI.
- **FR-015**: Unimplemented Agent modes MUST fall back to `react`.

## Key Entities

- **AgentMode**: Effective agent mode. Defaults to `react`; reserves `reflection` and `plan-and-execute`.
- **ReActTrace**: Session-only trace for a single assistant message.
- **ReActStep**: One ReAct round with Thought, Action, Observation, and optionally Final.
- **ReActContinuationState**: Waiting state created when the round limit is reached before Final.
- **AgentRuntime**: Runtime orchestration boundary for chat turns and future agent modes.

## Edge Cases

- No MCP tools are available while the user asks for Siyuan workspace data.
- LLM output cannot be interpreted as valid ReAct output.
- MCP tool call fails.
- User stops during LLM streaming or MCP tool execution.
- User is waiting for continuation and sends a new prompt.
- ReAct continues multiple times and pauses every 10 rounds.
- Tool output is too large for UI display.

## Success Criteria *(mandatory)*

- **SC-001**: User messages are handled by ReAct Runtime by default.
- **SC-002**: The assistant can proactively use Siyuan MCP tools for workspace-data questions without explicit MCP wording.
- **SC-003**: The user can expand a collapsed "思考过程" block to inspect Thought, Action, and Observation.
- **SC-004**: After 6 unfinished rounds, the system pauses and resumes from the same context when the user clicks red "继续".
- **SC-005**: The code and settings model reserve future Agent modes without exposing unfinished UI.

## Assumptions

- ReAct traces are session-only.
- Clearing chat clears ReAct traces.
- Reloading the plugin does not restore ReAct traces.
- Chat history remains non-persistent.
- Reflection and Plan-and-Execute are not implemented in this feature.
