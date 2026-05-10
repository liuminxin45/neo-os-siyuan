# Data Model: ReAct Agent Runtime

## AgentMode

Represents the agent mode used for chat orchestration.

- `react`: default and only implemented mode.
- `reflection`: reserved for future implementation.
- `plan-and-execute`: reserved for future implementation.

Current version does not expose a UI switch. Missing or unsupported values fall back to `react`.

## ReActTrace

Represents the visible thinking process for one assistant message.

Properties:

- Belongs to a single assistant message.
- Contains ordered ReAct steps.
- Is collapsed by default in UI.
- Is session-only.
- Is cleared when chat is cleared.
- Is not restored after plugin reload.
- Records whether Final exists.
- Records whether the trace is waiting for manual continuation.

## ReActStep

Represents one ReAct round.

Fields:

- `thought`: Visible model thinking text.
- `action`: Optional tool action record.
- `observation`: Optional summarized result or failure.
- `final`: Optional final answer text for the turn.

UI placement:

- Thought, Action, and Observation appear inside the collapsed "思考过程" block.
- Final appears as normal assistant answer content.

## ReActAction

Represents a tool decision made by the assistant.

Fields:

- Tool name.
- Argument summary.

Arguments are shown without masking.

## ReActObservation

Represents summarized tool output or tool failure.

Rules:

- Show a concise summary only.
- Do not show full raw MCP result JSON in UI.
- Tool failures are valid observations and can be used for continued reasoning.

## ReActContinuationState

Represents a paused assistant turn after the default 10-round limit is reached before Final.

Rules:

- Pause after each 10-round segment without Final.
- Show "已超过默认思考最大轮次，是否继续".
- Composer primary button becomes red "继续".
- Continuing resumes from the interruption point.
- Stopping clears continuation ability.
- Sending a new prompt abandons continuation.

## ChatSession Extensions

The session needs runtime-only state for:

- Active ReAct trace per assistant message.
- Whether the current turn is waiting for continuation.
- Continuation context needed to resume the same turn.
- Effective agent mode.

These extensions remain in memory and are not persisted.
