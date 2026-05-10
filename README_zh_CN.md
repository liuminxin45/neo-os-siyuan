# 思源 AI 聊天

一个个人使用优先的思源右侧 AI 聊天插件。

## 当前范围

- 右侧 Dock 聊天。
- 多个 LLM Profile。
- OpenAI-compatible Provider，支持自定义 Base URL。
- DeepSeek 简化配置，只需要 API Key 和模型名。
- MCP Server 配置，支持 stdio、SSE URL、Streamable HTTP URL。
- MCP 工具发现和可信自动调用。
- 聊天中显示工具名称和调用状态。
- 聊天记录仅保留在当前会话中。

## 注意

- LLM 和 MCP 配置会保存在本插件的思源私有插件数据中。
- 启用的 MCP Server 被视为可信，AI 可以自动调用。
- 当前版本不会读取思源文档上下文。
- 插件重载后不会恢复聊天消息。

## 开发

```powershell
npm install
npm run typecheck
npm run build
```
