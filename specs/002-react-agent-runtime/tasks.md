# Tasks: ReAct Agent Runtime

**Feature**: `002-react-agent-runtime`
**Prerequisites**: `spec.md`, `plan.md`, `data-model.md`
**Tests**: TypeScript check, contract check, build, focused runtime tests, manual validation

## Phase 1: Spec Artifacts

- [x] T001 Create `specs/002-react-agent-runtime/spec.md`.
- [x] T002 Create `specs/002-react-agent-runtime/plan.md`.
- [x] T003 Create `specs/002-react-agent-runtime/data-model.md`.
- [x] T004 Create `specs/002-react-agent-runtime/checklists/requirements.md`.
- [x] T005 Create `specs/002-react-agent-runtime/tasks.md`.

## Phase 2: Agent Runtime Foundations

- [x] T006 Add `AgentMode` model with `react`, `reflection`, and `plan-and-execute`.
- [x] T007 Add default `agentMode = react` to plugin settings normalization.
- [x] T008 Add ReAct trace models for Thought, Action, Observation, Final, pause state, and continuation state.
- [x] T009 Add Agent Runtime entrypoint that resolves mode and falls back to ReAct.
- [x] T010 Move chat turn orchestration from `ChatService` into Agent Runtime without changing user-visible behavior.

## Phase 3: ReAct Runtime

- [x] T011 Implement default ReAct loop for all providers.
- [x] T012 Ensure ReAct can answer no-tool questions with Thought and Final.
- [x] T013 Ensure workspace-data intents prioritize available MCP tools even when the user does not explicitly say MCP.
- [x] T014 Remove standalone MCP execution status bubbles and represent tool activity in ReAct trace.
- [x] T015 Store Action records with tool name and parameter summary.
- [x] T016 Store Observation records with tool result summary only.
- [x] T017 Allow tool failures to become Observation and continue reasoning.
- [x] T018 Keep provider adapters limited to wire protocol and normalized output parsing.

## Phase 4: Continuation and Stop Behavior

- [x] T019 Enforce 10-round ReAct segment limit.
- [x] T020 Pause assistant turn when 10 rounds complete without Final.
- [x] T021 Store continuation context so resume starts from interruption point.
- [x] T022 Implement continue action from waiting state.
- [x] T023 Re-pause every additional 10 rounds if Final is still missing.
- [x] T024 Ensure stop ends the turn and disables continuation.
- [x] T025 Ensure sending a new prompt abandons pending continuation.

## Phase 5: UI

- [x] T026 Add collapsed "思考过程" block to AI messages.
- [x] T027 Render ReAct steps as Thought, Action, and Observation by round.
- [x] T028 Keep Final answer in normal AI message body.
- [x] T029 Add pause hint: "已超过默认思考最大轮次，是否继续".
- [x] T030 Change composer primary button to red "继续" during waiting continuation.
- [x] T031 Preserve existing send/stop single-button behavior outside continuation.
- [x] T032 Ensure trace is session-only and cleared with chat.

## Phase 6: Tests and Validation

- [x] T033 Add runtime tests for AgentMode default and fallback.
- [x] T034 Add runtime tests for 10-round pause and continuation.
- [x] T035 Add runtime tests for stop and new-message abandonment.
- [x] T036 Add adapter tests or fixtures for DeepSeek/OpenAI-compatible tool calls.
- [x] T037 Add adapter tests or fixtures for Kimi tool_use flow.
- [x] T038 Add manual quickstart section for ReAct trace, MCP auto-use, pause, continue, stop.
- [x] T039 Run `npm run typecheck`.
- [x] T040 Run `npm run contract:check`.
- [x] T041 Run `npm run build`.

## Manual Acceptance Checklist

- [ ] 普通问题走 ReAct，并出现折叠 "思考过程"。
- [ ] 不提 MCP 时询问笔记本，AI 主动调用思源 MCP。
- [ ] 展开 "思考过程" 能看到 Thought / Action / Observation。
- [ ] Observation 只显示摘要，不显示完整原始 JSON。
- [ ] 超过 10 轮暂停并显示 "已超过默认思考最大轮次，是否继续"。
- [ ] 红色 "继续" 从原 AI 消息继续。
- [ ] 停止后不能继续。
- [ ] 等待继续时输入新问题会放弃旧继续状态。
