# Implementation Plan: LLM-Wiki Knowledge Kernel

**Feature**: `003-llm-wiki-knowledge-kernel`
**Spec**: `specs/003-llm-wiki-knowledge-kernel/spec.md`
**Status**: Implemented

## Summary

Add a knowledge-kernel layer to the Siyuan addon. The kernel turns LLM-Wiki into a governed personal AI knowledge base by loading AGENTS rules, scanning skill manifests, assembling layer-aware context, filtering/authorizing MCP tools, and writing audit records for successful knowledge mutations.

## Technical Context

**Runtime**: Siyuan plugin frontend runtime, TypeScript, Vite
**Existing Chat Runtime**: `ChatService` and `AgentRuntime`
**Existing MCP Runtime**: `McpService`
**Existing Skill UI**: `SiyuanSkillIndexReader` and skill palette
**New Boundary**: `LlmWikiKernel`

## Architecture

### Model Layer

Add `LlmWikiSettings`, `LlmWikiLayer`, `KnowledgeDocMeta`, `SkillManifest`, `AgentPolicySnapshot`, and `KnowledgeOperation`.

The path classifier is the canonical contract for the five-root LLM-Wiki structure.

### Siyuan Knowledge Store

Add a focused wrapper around official Siyuan APIs:

- `/api/notebook/lsNotebooks`
- `/api/query/sql`
- `/api/filetree/createDocWithMd`
- `/api/filetree/getIDsByHPath`
- `/api/export/exportMdContent`

This store is used for deterministic plugin-side context and audit writes.

### Kernel Services

`PolicyLoader` reads `/LLM-Wiki/AGENTS` and falls back to built-in safe rules.

`SkillRegistry` scans `skills/<name>/SKILL` and loads full selected skill markdown.

`ContextAssembler` builds context in the order AGENTS, selected skill, wiki index, related wiki, and raw evidence only when requested.

`McpToolPolicy` filters MCP tools and enforces auto-safe write governance.

`WriteLedger` writes successful mutating MCP call records to `/LLM-Wiki/runs/ledger/<date>/`.

### Chat Integration

`ChatService` asks the kernel to assemble context for LLM-Wiki prompts and selected skill runs. The resulting context is prepended to the user request as an explicit kernel block.

When the kernel is active, `ChatService` filters tools before passing them to `AgentRuntime`, authorizes each tool call before dispatching it to `McpService`, and records successful mutating tool calls after completion.

## Testing Strategy

- Static contract check for all new models and services.
- TypeScript check for integration boundaries.
- Existing agent runtime and MCP lifecycle checks remain valid.
- Manual validation covers AGENTS loading, skill context, raw evidence retrieval, auto-safe blocking, and ledger creation.

## Constraints

- Do not import Hermes Agent code.
- Do not add new LLM-Wiki root directories.
- Do not silently delete, move, or rename knowledge documents.
- Do not use `runs` as ordinary knowledge context.
