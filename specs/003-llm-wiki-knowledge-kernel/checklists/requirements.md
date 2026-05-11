# Requirements Checklist: LLM-Wiki Knowledge Kernel

## Completeness

- [x] Five-root target structure is specified.
- [x] AGENTS loading is specified.
- [x] Skill registry behavior is specified.
- [x] Wiki-first and raw-on-demand context behavior is specified.
- [x] MCP auto-safe write governance is specified.
- [x] Write ledger behavior is specified.

## Clarity

- [x] Destructive actions require confirmation.
- [x] `runs` is audit-only, not ordinary knowledge.
- [x] Hermes Agent is inspiration only, not an implementation dependency.
- [x] Siyuan API and MCP responsibilities are separated.

## Testability

- [x] Path classification can be checked automatically.
- [x] AGENTS fallback behavior can be checked automatically.
- [x] Skill manifest scanning can be checked automatically.
- [x] Raw evidence gating can be checked automatically.
- [x] Tool governance can be checked automatically.
- [x] Ledger creation can be manually validated in Siyuan.
