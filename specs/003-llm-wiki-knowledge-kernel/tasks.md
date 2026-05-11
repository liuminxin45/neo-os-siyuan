# Tasks: LLM-Wiki Knowledge Kernel

**Feature**: `003-llm-wiki-knowledge-kernel`
**Prerequisites**: `spec.md`, `plan.md`, `data-model.md`
**Tests**: TypeScript check, kernel contract check, existing runtime checks, build, manual validation

## Phase 1: Spec Artifacts

- [x] T001 Create `specs/003-llm-wiki-knowledge-kernel/spec.md`.
- [x] T002 Create `specs/003-llm-wiki-knowledge-kernel/plan.md`.
- [x] T003 Create `specs/003-llm-wiki-knowledge-kernel/data-model.md`.
- [x] T004 Create `specs/003-llm-wiki-knowledge-kernel/quickstart.md`.
- [x] T005 Create `specs/003-llm-wiki-knowledge-kernel/tasks.md`.
- [x] T006 Create `specs/003-llm-wiki-knowledge-kernel/checklists/requirements.md`.

## Phase 2: Kernel Models

- [x] T007 Add `LlmWikiSettings`.
- [x] T008 Add `LlmWikiLayer`.
- [x] T009 Add `KnowledgeDocMeta`.
- [x] T010 Add `SkillManifest`.
- [x] T011 Add `AgentPolicySnapshot`.
- [x] T012 Add `KnowledgeOperation`.
- [x] T013 Add five-layer path classification.

## Phase 3: Siyuan Store and Kernel Services

- [x] T014 Add `SiyuanKnowledgeStore` wrapper for required Siyuan APIs.
- [x] T015 Add AGENTS policy loading with safe fallback.
- [x] T016 Add skill manifest scanning for `skills/<name>/SKILL`.
- [x] T017 Add selected skill full markdown loading.
- [x] T018 Add layer-aware context assembler.
- [x] T019 Add MCP tool filter and auto-safe authorization.
- [x] T020 Add write ledger for successful mutating calls.

## Phase 4: Chat Integration

- [x] T021 Add kernel settings normalization.
- [x] T022 Wire `LlmWikiKernel` in plugin startup.
- [x] T023 Prepend kernel context for LLM-Wiki prompts.
- [x] T024 Filter MCP tools when the kernel is active.
- [x] T025 Block destructive MCP calls in auto-safe mode.
- [x] T026 Record successful mutating MCP calls to `runs/ledger`.

## Phase 5: Tests and Validation

- [x] T027 Add `tests/validate-llm-wiki-kernel.mjs`.
- [x] T028 Add `npm run llm-wiki:check`.
- [x] T029 Run `npm run llm-wiki:check`.
- [x] T030 Run `npm run typecheck`.
- [x] T031 Run `npm run agent:check`.
- [x] T032 Run `npm run mcp:lifecycle:check`.
- [x] T033 Run `npm run build`.

## Phase 6: Settings, Contracts, and Closeout

- [x] T034 Add LLM-Wiki Knowledge Kernel settings section in the settings modal.
- [x] T035 Add persistent setter for `LlmWikiSettings`.
- [x] T036 Extend plugin settings contract with `llmWiki`.
- [x] T037 Extend contract validation fixture with default LLM-Wiki settings.
- [x] T038 Add validation note for automated and runtime/manual coverage.

## Phase 7: AI Chat Full-Flow Hardening

- [x] T039 Keep kernel context in hidden `runtimeContent` so the chat UI and archives show only the user's visible prompt.
- [x] T040 Preserve active generation state while ReAct tool rounds are still running, so the stop control stays accurate.
- [x] T041 Ignore late MCP tool results after stop and avoid writing ledger entries for stopped generations.
- [x] T042 Enforce successful MCP mutation for LLM-Wiki write intents instead of allowing unsupported "saved" wording.
- [x] T043 Add `npm run chat:flow:check` for end-to-end plugin integration invariants.
- [x] T044 Require `skills/<name>/SKILL` before a directory is exposed as a selectable skill.
- [x] T045 Sync LLM-Wiki notebook AGENTS, layer indexes, runtime contract, and ledger note through SiYuan MCP/API.
- [x] T046 Run the full automated validation set after hardening.

## Manual Acceptance Checklist

- [ ] Runtime: 问“这个知识库有哪些能力”，AI 先参考 `AGENTS` 与 `skills`。
- [ ] Runtime: 提供一段新资料并要求保存，AI 写 raw、写 wiki，并返回变更清单。
- [ ] Runtime: 要求“找原文证据”，AI 不只看 wiki，能回查 raw。
- [ ] Runtime: 选择一个 skill 执行，AI 先理解完整 SKILL，再调用 MCP。
- [x] Automated: 普通知识问答不会把 `runs` 当作知识来源。
- [x] Automated: 高风险清理任务必须先列候选和影响，等待确认。

Runtime items require reloading the built plugin in SiYuan and sending real chat turns with an active LLM profile and MCP connection. Automated coverage and command results are recorded in `validation.md`.
