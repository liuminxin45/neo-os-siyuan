# Tasks: Side AI Chat, LLM Configuration, and MCP Configuration

**Input**: Design documents from `specs/001-side-ai-chat/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: TypeScript checks, Vite build, fake LLM/MCP fixtures, and manual quickstart validation.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Phase 1: Setup

**Purpose**: Establish the TypeScript/Vite plugin structure.

- [x] T001 Create `package.json` with `build`, `typecheck`, and `dev` scripts plus TypeScript/Vite dependencies.
- [x] T002 Create `tsconfig.json` for Siyuan plugin TypeScript source.
- [x] T003 Create `vite.config.ts` that emits Siyuan-loadable `index.js` and CSS output.
- [x] T004 Create source directories `src/adapters`, `src/models`, `src/services`, `src/ui`, and `src/utils`.
- [x] T005 Create `src/index.ts` as the plugin lifecycle entry.
- [x] T006 Create `src/styles.css` as the feature stylesheet entry.

---

## Phase 2: Foundational

**Purpose**: Core models, settings persistence, utility helpers, and adapter boundaries required by all stories.

- [x] T007 [P] Define chat models in `src/models/chat.ts`.
- [x] T008 [P] Define LLM profile models in `src/models/llm.ts`.
- [x] T009 [P] Define MCP server/tool/call models in `src/models/mcp.ts`.
- [x] T010 [P] Define plugin settings models in `src/models/settings.ts`.
- [x] T011 [P] Implement id generation helpers in `src/utils/ids.ts`.
- [x] T012 [P] Implement secret masking and safe error text helpers in `src/utils/masks.ts`.
- [x] T013 [P] Implement small DOM render helpers in `src/ui/render.ts`.
- [x] T014 Implement settings load/save/normalize in `src/services/settings-store.ts`.
- [x] T015 Implement LLM profile validation and defaults in `src/services/llm-profile-service.ts`.
- [x] T016 Implement MCP config validation and tool cache normalization in `src/services/mcp-service.ts`.
- [x] T017 Update `i18n/zh_CN.json` and `i18n/en_US.json` with base chat/settings/error keys.
- [x] T018 Run `npm run typecheck` and `npm run build` after setup compiles.
- [x] T060 [P] Create fake LLM streaming fixture in `tests/fixtures/fake-llm.ts`.
- [x] T061 [P] Create fake MCP stdio/SSE/Streamable HTTP fixture definitions in `tests/fixtures/fake-mcp.ts`.
- [x] T062 Verify stdio MCP feasibility in bundled Siyuan desktop runtime with `tests/fixtures/fake-mcp.ts`; pause and return to Plan Gate if child process/stdio is unavailable.

**Checkpoint**: Project builds with empty UI wiring and settings services available.

---

## Phase 3: User Story 1 - Chat In The Side Panel (Priority: P1)

**Goal**: User can open the right-side Dock chat, send messages with Enter, stop generation, and clear session-only chat.

**Independent Test**: Configure a fake LLM profile, open the right-side Dock, send a prompt, stop one generation, clear chat, and reload to confirm messages are not restored.

- [x] T019 [US1] Register right-side Dock, icon, and plugin lifecycle cleanup in `src/index.ts`.
- [x] T020 [US1] Render the chat shell, message list, input, send button, stop button, clear button, and settings button in `src/ui/chat-dock.ts`.
- [x] T021 [US1] Implement Enter send and Shift+Enter newline handling in `src/ui/chat-dock.ts`.
- [x] T022 [US1] Implement in-memory chat session state in `src/services/chat-service.ts`.
- [x] T023 [US1] Implement OpenAI-compatible chat completion request and streaming parser in `src/adapters/llm-chat-completions.ts`.
- [x] T024 [US1] Wire chat send, streaming assistant updates, recoverable LLM errors, and empty-message prevention in `src/services/chat-service.ts`.
- [x] T025 [US1] Implement stop-generation cancellation with AbortController in `src/services/chat-service.ts`.
- [x] T026 [US1] Implement manual clear chat in `src/ui/chat-dock.ts` and `src/services/chat-service.ts`.
- [x] T027 [US1] Style chat messages, input, in-progress state, stopped state, and empty state in `src/styles.css`.
- [x] T028 [US1] Add Chinese-first chat copy and English fallback keys in `i18n/zh_CN.json` and `i18n/en_US.json`.

**Checkpoint**: Side-panel chat works independently with an active LLM profile and no MCP configured.

---

## Phase 4: User Story 2 - Configure LLM Providers (Priority: P2)

**Goal**: User can configure multiple LLM profiles, including simplified DeepSeek and OpenAI-compatible custom Base URL, and switch active profile.

**Independent Test**: Add a DeepSeek profile and an OpenAI-compatible profile, switch active profile, and verify chat uses the selected profile.

- [x] T029 [US2] Implement settings modal shell opened from chat Dock in `src/ui/settings-modal.ts`.
- [x] T030 [US2] Implement LLM profile list, active profile selector, and profile editor UI in `src/ui/settings-modal.ts`.
- [x] T031 [US2] Implement OpenAI-compatible fields: name, Base URL, API key, and model in `src/ui/settings-modal.ts`.
- [x] T032 [US2] Implement simplified DeepSeek fields: name, API key, and model in `src/ui/settings-modal.ts`.
- [x] T033 [US2] Persist profile create/update/delete/select-active operations through `src/services/settings-store.ts`.
- [x] T034 [US2] Show field-specific LLM validation feedback from `src/services/llm-profile-service.ts`.
- [x] T035 [US2] Mask API keys in settings UI using `src/utils/masks.ts`.
- [x] T036 [US2] Update chat empty state when no active valid LLM profile exists in `src/ui/chat-dock.ts`.
- [x] T037 [US2] Style the settings modal and LLM profile form in `src/styles.css`.
- [x] T038 [US2] Add Chinese-first LLM settings copy and English fallback keys in `i18n/zh_CN.json` and `i18n/en_US.json`.

**Checkpoint**: Multiple LLM profiles are configurable, persisted, and selectable.

---

## Phase 5: User Story 3 - Configure MCP And Automatically Use Tools (Priority: P3)

**Goal**: User can configure MCP servers, discover tools, and see automatic tool-call status during chat.

**Independent Test**: Configure fake stdio and HTTP/SSE MCP servers, discover tools, send a prompt that triggers one tool, and verify tool name plus status appears without confirmation.

- [x] T039 [US3] Implement MCP server list and editor UI in `src/ui/settings-modal.ts`.
- [x] T040 [US3] Implement MCP stdio fields: name, command, args, env, enabled in `src/ui/settings-modal.ts`.
- [x] T041 [US3] Implement MCP SSE URL and Streamable HTTP URL fields in `src/ui/settings-modal.ts`.
- [x] T042 [US3] Persist MCP server create/update/delete/enable operations through `src/services/settings-store.ts`.
- [x] T043 [US3] Implement MCP transport client creation in `src/adapters/mcp-transports.ts`.
- [x] T044 [US3] Implement MCP tool discovery in `src/services/mcp-service.ts`.
- [x] T045 [US3] Implement discovered tool normalization and collision-safe tool naming in `src/services/mcp-service.ts`.
- [x] T046 [US3] Expose discovered MCP tools to LLM chat-completions request in `src/adapters/llm-chat-completions.ts`.
- [x] T047 [US3] Implement automatic MCP tool execution loop in `src/services/chat-service.ts`.
- [x] T048 [US3] Render tool name plus pending/running/success/failure status in `src/ui/chat-dock.ts`.
- [x] T049 [US3] Keep MCP tool result content out of the chat UI in `src/ui/chat-dock.ts`.
- [x] T063 [US3] Handle stop during MCP calls in `src/services/chat-service.ts` by best-effort cancellation, marking tool calls stopped, and ignoring late results.
- [x] T050 [US3] Mask MCP env values in settings UI using `src/utils/masks.ts`.
- [x] T051 [US3] Style MCP configuration and compact tool status rows in `src/styles.css`.
- [x] T052 [US3] Add Chinese-first MCP settings/tool status copy and English fallback keys in `i18n/zh_CN.json` and `i18n/en_US.json`.

**Checkpoint**: MCP configuration, discovery, and automatic trusted tool calls work with visible status.

---

## Phase 6: Polish & Verification

**Purpose**: Cross-story validation, docs, and cleanup.

- [x] T053 Validate persisted settings against `specs/001-side-ai-chat/contracts/plugin-settings.schema.json`.
- [x] T054 Validate runtime chat state shape against `specs/001-side-ai-chat/contracts/chat-session.schema.json` during fake fixture checks.
- [x] T055 Run `npm run typecheck`.
- [x] T056 Run `npm run build`.
- [x] T057 Execute manual validation in `specs/001-side-ai-chat/quickstart.md`; SSE runtime validation deferred by user, while stdio and Streamable HTTP were verified.
- [x] T058 Update `README.md` and `README_zh_CN.md` with first-version behavior, configuration notes, session-only history, and MCP auto-use warning.
- [x] T059 Review `git status --short` and keep changes scoped to `001-side-ai-chat`.

## Dependencies & Execution Order

- Phase 1 must complete before Phase 2.
- Phase 2 blocks all user stories.
- User Story 1 is the MVP and should be implemented first.
- User Story 2 depends on the settings store and should land before real-provider validation.
- User Story 3 depends on settings, chat service, and LLM tool-call request support.
- Polish depends on desired user stories being complete.

## Parallel Opportunities

- T007-T013 can run in parallel after directories exist.
- T029-T032 can be developed alongside T033-T035 if file ownership is coordinated.
- T039-T041 can be developed alongside T043-T045 after MCP models exist and T062 passes.
- CSS/i18n tasks can run in parallel with service work when UI structure is stable.

## Implementation Strategy

1. Complete setup and foundation.
2. Deliver side chat without MCP.
3. Add LLM profile modal and profile switching.
4. Add MCP configuration, discovery, and automatic tool calls.
5. Run quickstart and build verification.
