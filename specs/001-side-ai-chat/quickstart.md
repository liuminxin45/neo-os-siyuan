# Quickstart: Side AI Chat

## Preconditions

- The plugin is enabled in Siyuan desktop.
- The build artifacts are available after implementation.
- At least one valid LLM profile can be configured.
- A fake or real MCP stdio server is available for runtime feasibility validation.
- Fake or real MCP SSE and Streamable HTTP servers are available, or fixtures can validate one transport while form/schema validation covers the other.

## Build Checks

```powershell
npm install
npm run typecheck
npm run build
```

## Manual Validation

1. Reload Siyuan or reload the plugin.
2. Open the right-side Dock chat.
3. Confirm the chat shows a Chinese-first empty state when no LLM profile exists.
4. Open the settings modal from the chat Dock.
5. Add one DeepSeek profile with API key and model.
6. Add one OpenAI-compatible profile with name, Base URL, API key, and model.
7. Switch the active profile and confirm the selected profile is visible from the chat surface.
8. Add one MCP stdio server with command, optional args, and env values.
9. Validate the stdio server and confirm at least one tool can be discovered in Siyuan desktop.
10. Add one MCP SSE URL server.
11. Add one MCP Streamable HTTP URL server.
12. Validate or connect MCP servers and confirm tool discovery or validation status is visible for both HTTP transport styles.
13. Send a normal chat message with Enter.
14. Confirm Shift+Enter inserts a newline instead of sending.
15. Send a prompt that should trigger an MCP tool.
16. Confirm the chat shows tool name plus status without asking for confirmation.
17. Confirm tool result content is not displayed in the chat UI.
18. Start another generation and click stop generation.
19. If an MCP tool call is active, confirm it is marked stopped or ignored when late output returns.
20. Confirm generation stops and the input returns to an editable state.
21. Clear the chat.
22. Reload the plugin.
23. Confirm chat messages are gone.
24. Confirm LLM and MCP settings remain.
25. Confirm the assistant never reads or displays current Siyuan document context.

## Validation Notes

- Runtime tool discovery verified in Siyuan desktop for stdio MCP.
- Runtime tool discovery verified in Siyuan desktop for Streamable HTTP MCP.
- SSE runtime validation deferred by user for this delivery; SSE configuration UI and transport implementation remain in scope.

## Done Criteria

- Right-side Dock chat works.
- Settings modal manages multiple LLM profiles and MCP servers.
- DeepSeek setup only requires API key and model.
- OpenAI-compatible setup supports custom Base URL.
- MCP discovery and automatic tool-call status work.
- Stdio MCP feasibility has been proven in Siyuan desktop or implementation has paused for re-planning.
- Chat history is session-only.
- Stop generation works.
- Chinese copy is the primary user-facing copy.
