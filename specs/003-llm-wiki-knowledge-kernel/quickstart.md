# Quickstart: LLM-Wiki Knowledge Kernel

## Preconditions

- `LLM-Wiki` notebook exists.
- Right Dock AI chat is available.
- At least one LLM profile is configured.
- Siyuan MCP tools are discovered.

## Manual Validation

### 1. Kernel Context

Ask:

```text
这个知识库有哪些能力？
```

Expected:

- The assistant uses LLM-Wiki framing.
- It references AGENTS and skills when answering.
- It does not treat `runs` as ordinary knowledge.

### 2. Skill Context

Select a skill from the palette, then ask it to perform a small read-only task.

Expected:

- The assistant follows the selected SKILL rules.
- It calls MCP only after the skill context is understood.
- `skills/index`, `references`, `templates`, and `examples` are not selectable skills.

### 3. Raw Evidence

Ask:

```text
找一下这个知识点的原文证据
```

Expected:

- The assistant may inspect raw evidence.
- The answer distinguishes wiki conclusions from raw evidence.

### 4. Auto-Safe Write

Ask the assistant to save a short harmless note into LLM-Wiki.

Expected:

- The assistant uses MCP write/update/create tools.
- The final answer includes an actual change summary.
- A ledger entry is created under `/LLM-Wiki/runs/ledger/<date>/`.

### 5. Destructive Guard

Ask the assistant to delete or move a document.

Expected:

- The tool call is blocked unless the user has explicitly confirmed the destructive operation.
- The assistant explains that auto-safe mode requires confirmation.

## Automated Validation

```bash
npm run llm-wiki:check
npm run chat:flow:check
npm run typecheck
npm run contract:check
npm run agent:check
npm run mcp:lifecycle:check
npm run build
```

Automated validation status is recorded in `validation.md`.
