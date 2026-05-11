# Data Model: LLM-Wiki Knowledge Kernel

## LlmWikiSettings

Persistent plugin settings for the kernel.

- `enabled: boolean`
- `notebookName: string`
- `writeMode: "auto-safe" | "draft-first" | "read-only"`
- `language: "zh-CN"`
- `allowedMcpServerIds: string[]`
- `toolAllowlist: string[]`

## LlmWikiLayer

Path layer enum:

- `agents`
- `wiki`
- `raw`
- `skills`
- `runs`

## KnowledgeDocMeta

Context candidate metadata.

- `path`
- `layer`
- `kind`
- `title`
- `summary`
- `sourceRefs`
- `confidence`
- `updatedAt`

## SkillManifest

Skill entry generated from `/LLM-Wiki/skills/<name>/SKILL`.

- `name`
- `summary`
- `triggers`
- `sourcePath`
- `requiredTools`
- `writePolicy`

## AgentPolicySnapshot

AGENTS-derived rules.

- `rules`
- `roles`
- `toolPolicy`
- `loadedFrom`
- `loadedAt`

## KnowledgeOperation

Audit record for successful mutating MCP calls.

- `operationId`
- `action`
- `targetPath`
- `sourceRefs`
- `toolName`
- `status`
- `createdAt`
- `summary`
- `error`
