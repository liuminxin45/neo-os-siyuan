# Feature Specification: Side AI Chat, LLM Configuration, and MCP Configuration

**Feature Branch**: `001-side-ai-chat`
**Created**: 2026-05-10
**Status**: Implemented
**Input**: User description: "Side-panel AI chat with LLM configuration and MCP configuration for a personal Siyuan AI workspace."

## Clarification Summary

- The first version must support side-panel chat and automatic MCP tool use.
- The first version does not need document summarization, selected-text rewriting, document insertion, or reading Siyuan document context.
- LLM configuration must support OpenAI-compatible providers and DeepSeek.
- LLM configuration must also support Kimi CodingPlan through the Kimi coding endpoint.
- The first version must provide a right-side Dock entry.
- Chat sends with Enter. Shift+Enter inserts a newline.
- LLM configuration must support multiple profiles and active profile switching.
- DeepSeek should be simple: users only need to provide API key and model.
- MCP must support stdio and HTTP/SSE server configuration, tool discovery, and AI automatic tool calling.
- MCP automatic calls show tool name and status only; tool result content is not displayed in the chat UI.
- HTTP/SSE support includes both SSE URL and Streamable HTTP URL server styles.
- MCP stdio configuration must support environment variables.
- Chat history is session-only for now. It is not persisted to plugin data in this version.
- The plugin is a foundation for a future "LLM Wiki" workflow, but wiki-specific memory/history behavior is out of scope for this first version.
- Chat is the main side-panel surface. LLM and MCP settings are opened from the side panel as a modal dialog.
- UI copy is Chinese-first while still keeping English i18n available.
- The user must be able to stop an in-progress generation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chat In The Side Panel (Priority: P1)

A user opens a right-side Dock AI chat inside Siyuan, sends a normal message with Enter, and receives an assistant reply without leaving the current workspace.

**Why this priority**: Chat is the core user-facing experience. Without it, LLM and MCP configuration have no immediate value.

**Independent Test**: Configure a valid LLM profile, open the right-side Dock chat, send a short prompt with Enter, and verify that the user message and assistant reply appear in order.

**Acceptance Scenarios**:

1. **Given** the plugin is enabled and an LLM profile is configured, **When** the user sends a message from the right-side Dock, **Then** the chat shows the user message and assistant response in order.
2. **Given** a response is in progress, **When** the user views the chat, **Then** the UI shows a clear in-progress state.
3. **Given** the user sends an empty message, **When** they submit it, **Then** the plugin prevents the send and keeps the input available.
4. **Given** the LLM request fails, **When** the failure is returned, **Then** the chat shows a recoverable error state.
5. **Given** the input contains multiple lines, **When** the user presses Shift+Enter, **Then** the plugin inserts a newline instead of sending.
6. **Given** a response is in progress, **When** the user clicks stop generation, **Then** the plugin stops the current response and returns the input to an editable state.

---

### User Story 2 - Configure LLM Providers (Priority: P2)

A user configures one or more LLM provider profiles for OpenAI-compatible APIs or DeepSeek, switches the active profile, then uses that profile for chat.

**Why this priority**: The chat must work with user-provided provider settings and should not hard-code one service.

**Independent Test**: Add at least two profiles, save them, switch the active profile inside the side panel settings modal, and send a chat message.

**Acceptance Scenarios**:

1. **Given** no LLM profile exists, **When** the user opens the chat, **Then** the UI tells them LLM configuration is required.
2. **Given** the user opens the side panel settings modal, **When** they add an OpenAI-compatible profile with required fields, **Then** the plugin can use it for chat.
3. **Given** the user opens the side panel settings modal, **When** they add a DeepSeek profile with API key and model, **Then** the plugin can use it for chat without requiring base URL editing.
4. **Given** required fields are missing, **When** the user tries to save or use the profile, **Then** the plugin shows field-specific feedback.
5. **Given** multiple profiles exist, **When** the user switches the active profile, **Then** new chat messages use the selected profile.

---

### User Story 3 - Configure MCP And Automatically Use Tools (Priority: P3)

A user configures MCP servers, the plugin discovers available tools, and the AI automatically calls relevant tools during chat. The chat shows tool-call status without displaying tool result content.

**Why this priority**: MCP tool use is a core part of the intended personal AI workspace.

**Independent Test**: Configure a fake or real MCP server using stdio or HTTP/SSE, discover tools, send a prompt that requires one tool, and verify that the tool call status appears without a confirmation prompt.

**Acceptance Scenarios**:

1. **Given** the user adds an MCP server configuration, **When** they validate or connect it, **Then** the plugin shows whether tools can be discovered.
2. **Given** tools are discovered from an enabled MCP server, **When** the user sends a relevant prompt, **Then** the assistant may call the tool automatically without asking for confirmation.
3. **Given** a tool call succeeds, **When** the result returns, **Then** the chat shows the tool name and success status.
4. **Given** a tool call fails, **When** the error returns, **Then** the chat shows the tool name and failure status.
5. **Given** a tool result returns, **When** the chat updates, **Then** result content is not rendered in the chat UI.

---

### User Story 4 - Keep Chat Session Local And Temporary (Priority: P4)

A user can chat during the current plugin session and manually clear the visible conversation. The conversation is not persisted in this version.

**Why this priority**: Session-only history keeps the first version simple while leaving room for a later LLM Wiki memory model.

**Independent Test**: Send several messages, clear the chat, reload the plugin, and verify the conversation is gone while provider and MCP settings remain.

**Acceptance Scenarios**:

1. **Given** the chat contains messages, **When** the user clears the chat, **Then** the visible conversation is removed.
2. **Given** the plugin reloads, **When** the user opens the chat again, **Then** previous chat messages are not restored.
3. **Given** the chat is cleared or reloaded, **When** the user checks provider and MCP settings, **Then** those settings remain.

### Edge Cases

- No LLM provider is configured.
- The active LLM profile is incomplete or invalid.
- Multiple LLM profiles exist and the active profile is deleted.
- DeepSeek or OpenAI-compatible API returns an authentication, rate-limit, timeout, or malformed response error.
- The user submits an empty or whitespace-only message.
- An MCP server configuration is incomplete or invalid.
- MCP tool discovery returns no tools.
- MCP tool discovery fails.
- An MCP tool call fails or returns a large result that must not be displayed in the chat.
- The right-side Dock is closed while an LLM response or MCP tool call is in progress.
- The user stops generation while an LLM response or MCP tool call is in progress.
- The plugin reloads during a chat session.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The plugin MUST provide a right-side Dock chat surface inside Siyuan.
- **FR-002**: Users MUST be able to send chat messages from the side panel.
- **FR-003**: The chat MUST show user messages, assistant messages, in-progress state, and recoverable errors.
- **FR-004**: The plugin MUST prevent empty messages from being sent.
- **FR-005**: The plugin MUST support OpenAI-compatible LLM configuration.
- **FR-006**: The plugin MUST support simplified DeepSeek LLM configuration requiring only API key and model from the user.
- **FR-007**: Users MUST be able to save multiple LLM profiles and select an active profile.
- **FR-008**: The plugin MUST persist LLM provider configuration in plugin data.
- **FR-009**: The plugin MUST support MCP server configuration for stdio, SSE URL, and Streamable HTTP URL transports.
- **FR-010**: The plugin MUST discover tools from enabled MCP servers.
- **FR-011**: The assistant MUST be allowed to automatically call discovered MCP tools without per-call confirmation.
- **FR-012**: The chat MUST show MCP tool name and status only; tool result content MUST NOT be displayed in the chat UI.
- **FR-013**: The chat history MUST remain session-only in this version and MUST NOT be restored after plugin reload.
- **FR-014**: Users MUST be able to manually clear the current chat session.
- **FR-015**: The assistant MUST NOT read current Siyuan document content, selected text, blocks, backlinks, tags, or search results in this version.
- **FR-016**: Visible UI text MUST support Simplified Chinese and English.
- **FR-017**: Enter MUST send the chat message and Shift+Enter MUST insert a newline.
- **FR-018**: LLM and MCP configuration MUST be available from a modal dialog opened from the chat side panel.
- **FR-019**: MCP tool result content MUST be kept out of the chat UI even when the result is long.
- **FR-020**: Chinese MUST be the primary UX language for first-version copy.
- **FR-021**: The user MUST be able to stop an in-progress generation.
- **FR-022**: OpenAI-compatible LLM profiles MUST support custom Base URL.
- **FR-023**: MCP stdio server configuration MUST support environment variables.
- **FR-024**: The plugin MUST support a Kimi CodingPlan LLM profile that uses the fixed `https://api.kimi.com/coding` endpoint and the Anthropic Messages wire format.

### Key Entities *(include if feature involves data)*

- **LLM Profile**: A user-configured provider profile. Includes provider type, display name, base URL for OpenAI-compatible providers, API key, model, and active state.
- **MCP Server**: A user-configured MCP source. Includes display name, transport type, connection details, optional environment variables for stdio, enabled state, validation state, and discovered tools.
- **MCP Tool Call**: A single automatic tool call made during chat. Includes tool name, status, internal result summary for LLM continuation, and error state.
- **Chat Session**: The current in-memory list of user messages, assistant messages, and tool-call status entries.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can configure an LLM profile and complete a side-panel chat exchange.
- **SC-002**: A user can create multiple LLM profiles and switch which profile is active.
- **SC-003**: A user can configure an MCP server, discover at least one tool, and see that tool called automatically during chat.
- **SC-004**: Reloading the plugin clears chat messages while preserving LLM and MCP settings.
- **SC-005**: The assistant does not access Siyuan document context during this version's chat flow.
- **SC-006**: Tool call status is visible in the chat, and tool result content is not displayed in the visible conversation.

## Assumptions

- This version is for personal use first.
- The user accepts default online LLM operation once provider settings exist.
- Enabled MCP servers are trusted for automatic tool use.
- LLM Wiki memory and persistent chat history are future features, not part of this version.
- First-version settings open as a modal from the chat side panel.
