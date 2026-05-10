# Siyuan AI Chat

A personal right-side AI chat plugin for Siyuan.

## Current Scope

- Right-side Dock chat.
- Multiple LLM profiles.
- OpenAI-compatible provider with custom Base URL.
- Simplified DeepSeek provider with API Key and model.
- MCP server configuration for stdio, SSE URL, and Streamable HTTP URL.
- MCP tool discovery and trusted automatic tool calls.
- Tool name and status shown in chat.
- Session-only chat history.

## Notes

- LLM and MCP settings are stored in this plugin's private Siyuan plugin data.
- Enabled MCP servers are trusted and may be called automatically.
- The assistant does not read Siyuan document context in this version.
- Chat messages are not restored after plugin reload.

## Development

```powershell
npm install
npm run typecheck
npm run build
```
