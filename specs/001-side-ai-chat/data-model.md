# Data Model: Side AI Chat

## PluginSettings

Persisted through SiYuan plugin data.

- `schemaVersion`: Settings schema version.
- `activeProfileId`: Active LLM profile id.
- `llmProfiles`: List of configured LLM profiles.
- `mcpServers`: List of configured MCP servers.
- `mcpToolCache`: Optional discovered tool metadata keyed by MCP server id.

Validation:

- `activeProfileId` must be empty or refer to an existing LLM profile.
- `llmProfiles` may be empty, but chat send is disabled until an active valid profile exists.
- `mcpServers` may be empty; chat still works without tools.

## LLMProfile

- `id`: Stable local id.
- `name`: User-visible profile name.
- `provider`: `openai-compatible` or `deepseek`.
- `baseUrl`: Required for `openai-compatible`; hidden/preset for `deepseek`.
- `apiKey`: Required secret.
- `model`: Required model id.
- `isActive`: Derived from `PluginSettings.activeProfileId`, not separately persisted.
- `createdAt`: ISO timestamp.
- `updatedAt`: ISO timestamp.

Validation:

- `name`, `apiKey`, and `model` are required for all providers.
- `baseUrl` is required only for OpenAI-compatible profiles and must be an HTTP(S) URL.
- DeepSeek profile editing must not require Base URL.

## MCPServer

- `id`: Stable local id.
- `name`: User-visible server name.
- `transport`: `stdio`, `sse`, or `streamable-http`.
- `enabled`: Whether this server is available for discovery and automatic tool use.
- `command`: Required for `stdio`.
- `args`: Optional list for `stdio`.
- `env`: Optional key-value map for `stdio`.
- `url`: Required for `sse` and `streamable-http`.
- `status`: `idle`, `validating`, `ready`, or `error`.
- `lastError`: Optional user-visible error.
- `updatedAt`: ISO timestamp.

Validation:

- Enabled servers must have valid transport-specific fields.
- `stdio` requires `command`; `sse` and `streamable-http` require `url`.
- `env` values are secret-like and should be masked in the settings modal.

## MCPTool

Discovered from an enabled MCP server.

- `serverId`: MCP server id.
- `name`: Tool name.
- `description`: Tool description.
- `inputSchema`: JSON schema-like tool input shape.

Validation:

- Tool names must be non-empty.
- Tool names exposed to the LLM must be unique or namespaced to avoid collisions.

## MCPToolCall

In-memory only.

- `id`: Stable local id.
- `serverId`: MCP server id.
- `toolName`: Tool name.
- `status`: `pending`, `running`, `success`, `error`, or `stopped`.
- `startedAt`: ISO timestamp.
- `finishedAt`: Optional ISO timestamp.
- `argumentsSummary`: Optional display-safe summary.
- `outputSummary`: Optional internal summary used for LLM continuation, not rendered in the chat UI.
- `error`: Optional user-visible error.

Validation:

- Tool calls must reference an enabled MCP server and discovered tool.
- Full output must not be rendered in the chat UI.
- Long output must stay internal and must not flood the visible conversation.
- Stopped tool calls must ignore late success or error output for the stopped assistant turn.

## ChatMessage

In-memory only.

- `id`: Stable local id.
- `role`: `user`, `assistant`, or `tool-status`.
- `content`: Message text.
- `createdAt`: ISO timestamp.
- `status`: `pending`, `streaming`, `complete`, `error`, or `stopped`.
- `toolCallId`: Optional link for `tool-status` messages.

Validation:

- User messages must not be empty after trimming.
- Assistant messages may be partial while streaming.
- Tool status messages show tool name and status, not tool result content.

## ChatSession

In-memory only.

- `messages`: Ordered chat messages.
- `toolCalls`: Ordered tool call states.
- `isGenerating`: Whether an assistant turn is active.
- `abortController`: Runtime-only cancellation handle.
- `generationId`: Runtime-only token used to ignore late LLM chunks or MCP tool results after stop.

Validation:

- Only one generation is active in the first version.
- Clearing chat empties `messages` and `toolCalls`, and stops any active generation.
