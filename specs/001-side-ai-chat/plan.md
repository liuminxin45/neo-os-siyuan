# Implementation Plan: Side AI Chat, LLM Configuration, and MCP Configuration

**Branch**: `001-side-ai-chat` | **Date**: 2026-05-10 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-side-ai-chat/spec.md`

## Summary

Build a right-side Siyuan Dock chat panel for a personal AI workspace. The first version supports session-only chat, multiple LLM profiles, OpenAI-compatible custom Base URL profiles, simplified DeepSeek profiles, MCP server configuration, MCP tool discovery, and trusted automatic MCP tool calls. LLM/MCP settings open as a modal from the chat panel. The assistant must not read Siyuan document context in this version.

## Technical Context

**Language/Version**: TypeScript targeting Siyuan plugin runtime
**Primary Dependencies**: Vite, TypeScript, `siyuan`, stable v1 MCP TypeScript SDK package, browser/runtime `fetch` for OpenAI-compatible chat calls
**Storage**: Siyuan plugin data for LLM/MCP settings only; chat history remains in memory
**Testing**: TypeScript check, Vite build, fake LLM adapter, fake MCP server/client fixtures, manual quickstart validation
**Target Platform**: Siyuan desktop first, right-side Dock UI
**Project Type**: Single Siyuan plugin package
**Performance Goals**: Dock opens immediately; sending shows state within one interaction frame; tool status updates are visible without flooding chat
**Constraints**: No Siyuan document context access; no chat persistence; MCP enabled servers are trusted; first-version copy is Chinese-first
**Scale/Scope**: One active chat session, multiple LLM profiles, multiple MCP server configs, one or more discovered MCP tools per enabled server

**Runtime Assumption**: Stdio MCP is desktop-only and requires Node child process access from the bundled Siyuan plugin runtime. This must be proven with a fake stdio MCP fixture before US3 implementation proceeds.

## Architecture

### Source Layout

```text
package.json
tsconfig.json
vite.config.ts
src/
├── index.ts
├── styles.css
├── adapters/
│   ├── llm-chat-completions.ts
│   └── mcp-transports.ts
├── models/
│   ├── chat.ts
│   ├── llm.ts
│   ├── mcp.ts
│   └── settings.ts
├── services/
│   ├── chat-service.ts
│   ├── llm-profile-service.ts
│   ├── mcp-service.ts
│   └── settings-store.ts
├── ui/
│   ├── chat-dock.ts
│   ├── settings-modal.ts
│   └── render.ts
└── utils/
    ├── ids.ts
    ├── masks.ts
    └── text.ts
```

### Runtime Flow

1. `src/index.ts` registers plugin lifecycle, right-side Dock, icons, and cleanup.
2. `settings-store.ts` loads and saves provider/MCP settings through Siyuan plugin data APIs.
3. `chat-dock.ts` renders the main chat surface and opens `settings-modal.ts`.
4. `chat-service.ts` owns the in-memory chat session, generation state, AbortController, and tool-call orchestration.
5. `llm-chat-completions.ts` sends OpenAI-compatible chat requests. DeepSeek uses a preset Base URL while exposing only API key and model fields to the user.
6. `mcp-service.ts` connects enabled MCP servers, discovers tools, exposes tool schemas to the LLM call, executes requested tool calls, and returns tool results internally to the assistant loop.
7. The UI displays tool name plus status only. Tool result content stays internal to the assistant loop and is not rendered in chat.

## Dependency Strategy

- Use TypeScript and Vite now because the Constitution explicitly allows them and this feature has multiple contracts.
- Use direct `fetch` for LLM calls instead of OpenAI/DeepSeek SDKs so OpenAI-compatible custom Base URL remains simple.
- Use stable v1 MCP TypeScript SDK for client transports. The current SDK main branch is v2 pre-alpha, so production planning should pin a stable v1 package/version during implementation.
- Add a small local abstraction over MCP transports so stdio, SSE URL, and Streamable HTTP URL can share discovery and call lifecycle.
- Treat stdio MCP as a required capability with an explicit feasibility gate. If the bundled plugin cannot spawn/connect to a stdio MCP process in Siyuan desktop, pause and return to Specify/Plan Gate instead of silently dropping stdio.

## UI/UX Selection

This feature uses the Constitution's context-aware UI/UX direction for an embedded personal productivity AI workspace.

- **Base**: Native Siyuan Dock and modal behavior.
- **Chat**: Intercom-like readable message stack, clear input, clear in-progress state, and no marketing surface.
- **Settings**: Notion-like calm grouping for LLM profiles and MCP servers inside a modal.
- **Tools**: Raycast/Cursor-like compact status rows: tool name plus pending/running/success/failure.
- **Motion**: Minimal state transitions for sending, stopping, validation, and tool status; no decorative motion.

## Constitution Check

- **Personal AI Workspace First**: PASS. The plan assumes trusted personal settings and future publish review.
- **Default Online AI Operation**: PASS. Configured active LLM profiles may be called directly.
- **Private Plugin Data May Store Secrets**: PASS. LLM API keys and MCP env values persist in plugin data and are masked where shown.
- **Always-Allow MCP Tool Use**: PASS. Enabled MCP servers are trusted automatic tool sources.
- **TypeScript And Vite Are Allowed**: PASS. TypeScript/Vite are selected as the main toolchain.
- **Complete Spec-Kit Workflow Is Mandatory**: PASS. This is Plan Gate only; design artifacts and tasks are not created in this step.
- **Context-Aware UI/UX Selection**: PASS. UI selection is documented above.

## Data And Persistence

- Persisted:
  - LLM profiles
  - active LLM profile id
  - MCP server configs
  - discovered tool metadata cache if useful
- Not persisted:
  - chat messages
  - active generation state
  - MCP tool call history

## Error And Cancellation Strategy

- Empty message: prevent send and keep input focused.
- LLM profile missing/invalid: show Chinese-first configuration prompt.
- LLM failure: append recoverable assistant-side error state; no retry button in v1.
- Stop generation: abort the current LLM request and mark the current assistant turn as stopped.
- MCP call during stop: perform best-effort cancellation when supported, mark the visible tool call as `stopped`, ignore late tool results for that turn, and return input to editable state.
- MCP discovery failure: show server validation/discovery status in settings modal.
- MCP tool call failure: show tool name plus failure status in chat; continue with a user-safe assistant error state if needed.
- Dock close during generation: keep in-memory state while plugin remains loaded; cleanup on unload.

## Project Structure

### Documentation

```text
specs/001-side-ai-chat/
├── spec.md
├── checklists/
│   └── requirements.md
└── plan.md
```

### Source Code

```text
src/
├── index.ts
├── styles.css
├── adapters/
├── models/
├── services/
├── ui/
└── utils/
```

**Structure Decision**: Use a small modular TypeScript plugin rather than a frontend framework. This keeps the side Dock light, avoids nested app complexity, and leaves room to add a framework later only if UI complexity justifies it.

## Next Gate Inputs

Design Gate should create:

- `research.md`: confirm exact MCP SDK package/version and transport API names, confirm Siyuan Dock positioning details, confirm streaming chat response format for DeepSeek/OpenAI-compatible.
- `data-model.md`: define LLM profile, MCP server, discovered tool, tool call, chat message, plugin settings.
- `contracts/`: define JSON schemas for persisted settings and internal adapter contracts.
- `quickstart.md`: define manual validation steps for chat, profile switch, MCP discovery, auto tool status, stop generation, and session-only history.

## Complexity Tracking

No Constitution violations are introduced by this plan.
