# Feature Specification: LLM-Wiki Knowledge Kernel

**Feature Branch**: `003-llm-wiki-knowledge-kernel`
**Created**: 2026-05-11
**Status**: Implemented
**Input**: User request to turn LLM-Wiki into a self-consistent, upgradeable personal AI knowledge base managed by the Siyuan addon AI chat through Siyuan API and MCP tools.

## Clarification Summary

- LLM-Wiki keeps the five-root structure: `AGENTS`, `wiki`, `raw`, `skills`, and `runs`.
- The first implementation focuses on the knowledge-kernel foundation, not multi-agent parallelism.
- The assistant uses Chinese-first behavior.
- Write mode defaults to `auto-safe`: create, append, and update are allowed; delete, move, and rename are blocked until explicit user confirmation.
- Hermes Agent is used as product inspiration only; no Hermes code is imported.
- Siyuan official API is used for deterministic plugin-side reads and audit writes; MCP remains the model-facing action layer.

## User Scenarios & Testing

### User Story 1 - Knowledge Rules Are Loaded

A user asks about the knowledge base or asks the AI to maintain it. The assistant receives the LLM-Wiki AGENTS policy snapshot before acting.

**Acceptance Scenarios**:

1. Given `/LLM-Wiki/AGENTS` exists, when an LLM-Wiki prompt is sent, then the kernel includes a policy snapshot loaded from that document.
2. Given `/LLM-Wiki/AGENTS` is unavailable, when an LLM-Wiki prompt is sent, then the kernel falls back to safe built-in rules and reports a warning in context.

### User Story 2 - Skills Are Progressive Context

A user selects a skill from the chat palette. The assistant receives the selected skill manifest and full `SKILL` document before executing tool work.

**Acceptance Scenarios**:

1. Given a selected skill, when the prompt is assembled, then the kernel includes the skill name, source path, summary, and full SKILL markdown.
2. Given `skills/*/references` documents exist, when the skill registry scans skills, then only direct `skills/<name>/SKILL` entries become skill manifests.

### User Story 3 - Knowledge Retrieval Respects Layers

A user asks a normal knowledge question. The assistant should prefer `wiki` and avoid treating `runs` or `raw` as ordinary knowledge.

**Acceptance Scenarios**:

1. Given a normal knowledge question, when context is assembled, then related wiki candidates may be included.
2. Given the user asks for original text, evidence, source, or full content, when context is assembled, then raw evidence candidates may be included.
3. Given a normal question, when context is assembled, then `runs` is described as audit-only and is not searched as knowledge.

### User Story 4 - Tool Writes Are Governed

The assistant can maintain the knowledge base but cannot perform destructive changes silently.

**Acceptance Scenarios**:

1. Given auto-safe mode, when the model calls create/write/append/update style MCP tools, then the call is allowed if the tool is otherwise authorized.
2. Given auto-safe mode, when the model calls delete/remove/move/rename style MCP tools, then the call is blocked with a clear policy error.
3. Given a successful mutating tool call, then a ledger document is written under `/LLM-Wiki/runs/ledger/<date>/`.

## Requirements

- **FR-001**: The system MUST define reusable LLM-Wiki settings with `enabled`, `notebookName`, `writeMode`, `language`, `allowedMcpServerIds`, and `toolAllowlist`.
- **FR-002**: The system MUST classify LLM-Wiki paths into `agents`, `wiki`, `raw`, `skills`, and `runs`.
- **FR-003**: The system MUST load `/LLM-Wiki/AGENTS` as the first policy source for LLM-Wiki prompts.
- **FR-004**: The system MUST provide a safe fallback policy if AGENTS cannot be read.
- **FR-005**: The system MUST scan direct `skills/<name>/SKILL` documents as skill manifests.
- **FR-006**: The system MUST include full selected SKILL markdown in kernel context when available.
- **FR-007**: The system MUST prefer wiki context for ordinary knowledge questions.
- **FR-008**: The system MUST only include raw evidence context when the user asks for evidence, source, original text, or full content.
- **FR-009**: The system MUST not treat `runs` as ordinary knowledge context.
- **FR-010**: The system MUST filter MCP tools by LLM-Wiki settings when the kernel is active.
- **FR-011**: The system MUST block destructive MCP actions in `auto-safe` mode.
- **FR-012**: The system MUST record successful mutating MCP calls into `runs/ledger`.

## Key Entities

- **LlmWikiSettings**: Persistent settings for enabling the kernel, notebook selection, write mode, language, and tool authorization.
- **AgentPolicySnapshot**: Loaded AGENTS rules, role names, and tool policy.
- **SkillManifest**: Skill entry generated from `skills/<name>/SKILL`.
- **KnowledgeDocMeta**: Lightweight document candidate metadata used in context assembly.
- **KnowledgeOperation**: Audit record for a successful mutating MCP call.
- **LlmWikiKernel**: The orchestration boundary for policy loading, skill registry, context assembly, MCP policy, and write ledger.

## Success Criteria

- **SC-001**: LLM-Wiki prompts receive a kernel context block before the user request.
- **SC-002**: A selected skill includes full SKILL markdown in context.
- **SC-003**: Path classification covers all five core layers.
- **SC-004**: Auto-safe write governance allows non-destructive writes and blocks destructive operations.
- **SC-005**: Successful mutating MCP calls are auditable under `runs`.

## Assumptions

- Existing duplicate or stale LLM-Wiki documents are not deleted by this feature.
- Real database/AV maintenance is reserved for later specs; this feature creates the typed boundary for it.
- UI controls for LLM-Wiki settings can be added later; defaults are active immediately.
