# Research: Side AI Chat, LLM Configuration, and MCP Configuration

## Sources Checked

- MCP TypeScript SDK repository and v1 documentation.
- SiYuan plugin development community documentation.
- DeepSeek official chat completion API documentation.

## Decision 1: MCP SDK Package

**Decision**: Use the stable v1 MCP TypeScript SDK package `@modelcontextprotocol/sdk` with `zod` during implementation.

**Rationale**: The MCP TypeScript SDK repository states that the `main` branch is v2 pre-alpha and that v1.x remains recommended for production use. The v1 documentation lists `@modelcontextprotocol/sdk` and `zod` as the install path and documents stdio, Streamable HTTP, and HTTP+SSE compatibility.

**Alternatives Considered**:

- Use v2 split packages (`@modelcontextprotocol/client`): rejected for this feature because v2 is still pre-alpha.
- Hand-roll MCP JSON-RPC transports: rejected because it would duplicate protocol behavior and increase risk.

## Decision 2: MCP Transport Support

**Decision**: Model the first version around three user-facing transport options:

- `stdio`: command, args, env.
- `sse`: legacy HTTP+SSE endpoint.
- `streamable-http`: recommended remote HTTP endpoint.

**Rationale**: The spec requires stdio and HTTP/SSE, and clarification requires both SSE URL and Streamable HTTP URL styles. MCP v1 docs describe Streamable HTTP as recommended for remote servers, HTTP+SSE as backwards compatibility, and stdio as local process integration.

**Implications**:

- Settings must validate fields based on transport.
- UI copy should label HTTP/SSE as two options rather than one ambiguous field.
- The MCP adapter must hide transport-specific connection details behind one discovery/call interface.
- `stdio` support is desktop-only and depends on Node child process access from the Siyuan plugin runtime after Vite bundling. Implementation must verify this before building the full stdio path.

## Decision 3: LLM Chat API

**Decision**: Use direct OpenAI-compatible `/chat/completions` HTTP calls with streaming support instead of provider SDKs.

**Rationale**: OpenAI-compatible profiles require custom Base URL. DeepSeek's official API uses `/chat/completions`, supports messages, tools, `tool_choice: auto`, and SSE streaming when `stream: true`. Direct fetch keeps OpenAI-compatible and DeepSeek paths aligned.

**Implications**:

- OpenAI-compatible profiles expose Base URL, API key, and model.
- DeepSeek profiles expose API key and model only, with a preset Base URL.
- Tool calls are represented as function tools sent to the LLM; MCP tool results are fed back into the conversation internally.

## Decision 4: SiYuan Plugin UI Surface

**Decision**: Use a right-side Dock for chat and a `Dialog`-style modal opened from the chat Dock for LLM/MCP settings.

**Rationale**: SiYuan documentation shows `addDock` supports right-side positions such as `RightBottom`, and `Dialog` is an established way to host custom setting panels. This matches the clarified requirement: chat is the main side-panel surface, settings are a modal.

**Implications**:

- The plugin should avoid writing to document DOM or reading document context.
- Plugin settings must be saved when edited, not from `onunload`, to avoid sync overwrite risks described in SiYuan documentation.

## Decision 5: Session-Only Chat State

**Decision**: Keep chat messages, generation state, and tool-call history in memory only.

**Rationale**: The first version is a workflow foundation, not the LLM Wiki memory layer. Persisting chat now would force retention, export, cleanup, and privacy decisions that were explicitly deferred.

**Implications**:

- Reloading the plugin clears chat.
- Clearing chat does not touch LLM/MCP settings.
- Quickstart must verify that settings persist and chat history does not.

## Decision 6: Stdio MCP Feasibility Gate

**Decision**: Treat stdio MCP as a required first-version feature, but add an explicit implementation gate that proves the Siyuan desktop plugin runtime can start and communicate with a stdio MCP process.

**Rationale**: The product requirement includes stdio MCP. The MCP SDK supports stdio, but protocol support alone does not prove the host plugin runtime can spawn child processes once bundled with Vite and loaded by Siyuan.

**Feasibility Gate**:

1. Build the plugin with Vite.
2. Load it in Siyuan desktop.
3. Attempt a minimal stdio MCP connection to a fake local server.
4. Discover one fake tool.
5. If this fails because child process or stdio transport is unavailable, pause implementation and return to Specify/Plan Gate.

**Alternatives Considered**:

- Remove stdio from v1: rejected because the clarified spec explicitly requires it.
- Proceed without a gate: rejected because it could hide a runtime blocker until late implementation.

## Decision 7: Stop Behavior During MCP Calls

**Decision**: Stop generation applies to the whole assistant turn. For LLM streaming, cancel with AbortController. For MCP tool calls, perform best-effort cancellation when the SDK/transport supports it, mark the visible tool call as `stopped`, ignore late results, and return the input to an editable state.

**Rationale**: Some MCP tools may not support true cancellation. The UI must still behave predictably when the user stops generation.

**Implications**:

- Chat service needs a generation id or turn token to ignore late tool results.
- Tool-call state must include `stopped`.
- A stopped tool call should not append normal success output later.
