# Validation Note: LLM-Wiki Knowledge Kernel

**Date**: 2026-05-11
**Status**: Automated validation passed; runtime chat smoke test prepared for user execution after plugin reload.

## Automated Validation

Passed:

```bash
npm run llm-wiki:check
npm run chat:flow:check
npm run typecheck
npm run contract:check
npm run agent:check
npm run mcp:lifecycle:check
npm run build
```

Coverage:

- Five-layer path classification: `AGENTS`, `wiki`, `raw`, `skills`, `runs`.
- AGENTS policy loader and fallback policy presence.
- Skill registry and selected SKILL loading boundary.
- Context assembler rule that ordinary knowledge queries do not search `raw`.
- `runs` is described as audit-only, not ordinary knowledge context.
- MCP tool filtering and auto-safe destructive-operation blocking.
- Write ledger implementation under `/LLM-Wiki/runs/ledger/<date>/`.
- Settings persistence, settings modal entry, and plugin-settings contract coverage for `llmWiki`.
- Chat UI stores and displays only the user's visible prompt while hidden `runtimeContent` carries kernel context to the runtime.
- ReAct generation keeps the stop control active until the runtime actually finishes.
- Late MCP tool results from stopped generations are ignored and do not create ledger entries.
- LLM-Wiki write intents require a successful MCP mutation before the assistant can complete as saved.
- Skill discovery only exposes directories that contain `skills/<name>/SKILL`; index/reference pages are not selectable skills.
- LLM-Wiki notebook runtime contract was synced through SiYuan MCP/API: `AGENTS`, `wiki/index`, `raw/index`, `skills/index`, `runs/index`, runtime contract, raw validation note, and ledger note.
- Existing ReAct runtime, MCP lifecycle, and build checks.

## Runtime Validation Still Requiring SiYuan UI

These require reloading the built plugin in SiYuan, using an active LLM profile, and sending real chat turns:

- Ask “这个知识库有哪些能力？” and confirm the answer uses AGENTS and skills context.
- Select a skill and confirm the assistant follows the full SKILL context.
- Ask for raw/original evidence and confirm raw evidence is considered only for that intent.
- Ask for a harmless save and confirm raw/wiki writes plus a ledger entry.

## Notes

- Destructive operations are intentionally blocked in `auto-safe` mode until explicit user confirmation is implemented as a runtime confirmation workflow.
- Duplicate legacy `runs` document traces were observed in the notebook tree and intentionally left untouched because deletion/move requires explicit confirmation.
- No Hermes Agent code was imported.
- No new LLM-Wiki root directory was introduced.
