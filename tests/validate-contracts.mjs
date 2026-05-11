import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const contractDir = path.resolve("specs/001-side-ai-chat/contracts");
const readSchema = (name) => JSON.parse(fs.readFileSync(path.join(contractDir, name), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const name of [
  "llm-profile.schema.json",
  "mcp-server.schema.json",
  "mcp-tool.schema.json",
  "plugin-settings.schema.json",
  "chat-session.schema.json",
]) {
  ajv.addSchema(readSchema(name));
}

const now = new Date("2026-05-10T00:00:00.000Z").toISOString();
const settings = {
  schemaVersion: 1,
  activeProfileId: "llm_deepseek",
  llmProfiles: [
    {
      id: "llm_deepseek",
      name: "DeepSeek",
      provider: "deepseek",
      apiKey: "sk-test",
      model: "deepseek-chat",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "llm_compatible",
      name: "OpenAI Compatible",
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-compatible",
      createdAt: now,
      updatedAt: now,
    },
  ],
  mcpServers: [
    {
      id: "mcp_stdio",
      name: "Local Tools",
      transport: "stdio",
      enabled: true,
      command: "node",
      args: ["tests/fixtures/fake-mcp.ts"],
      env: { TEST_TOKEN: "secret" },
      status: "ready",
      updatedAt: now,
    },
    {
      id: "mcp_sse",
      name: "Remote SSE",
      transport: "sse",
      enabled: true,
      url: "http://127.0.0.1:3333/sse",
      status: "idle",
      updatedAt: now,
    },
  ],
  mcpToolCache: {
    mcp_stdio: [
      {
        serverId: "mcp_stdio",
        name: "search",
        llmName: "Local_Tools_search",
        description: "Fake searchable tool",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      },
    ],
  },
  agentMode: "react",
  maxMemoryTurns: 10,
  llmWiki: {
    enabled: true,
    notebookName: "LLM-Wiki",
    writeMode: "auto-safe",
    language: "zh-CN",
    allowedMcpServerIds: [],
    toolAllowlist: [],
  },
};

const chatSession = {
  conversationId: "conv_1778307810068_5jot5q",
  messages: [
    {
      id: "msg_user",
      role: "user",
      content: "查一下",
      runtimeContent: "LLM-WIKI KNOWLEDGE KERNEL CONTEXT\n\n查一下",
      createdAt: now,
      status: "complete",
    },
    {
      id: "msg_assistant",
      role: "assistant",
      content: "已完成。",
      createdAt: now,
      status: "complete",
      references: [{ title: "参考文档", path: "wiki/knowledge/ref.md", sourceLabel: "LLM Wiki" }],
      reactTrace: {
        collapsed: true,
        waitingContinuation: false,
        steps: [
          {
            id: "react_1",
            round: 1,
            thought: "需要查询。",
            actions: [{ toolName: "search", argumentsSummary: "{\"query\":\"查一下\"}" }],
            observations: [{ status: "success", summary: "{\"ok\":true}" }],
            status: "complete",
          },
        ],
      },
    },
  ],
  toolCalls: [
    {
      id: "tool_1",
      serverId: "mcp_stdio",
      toolName: "search",
      llmName: "Local_Tools_search",
      status: "success",
      startedAt: now,
      finishedAt: now,
      argumentsSummary: "{\"query\":\"查一下\"}",
      outputSummary: "{\"ok\":true}",
    },
  ],
  isGenerating: false,
  generationId: "gen_done",
  agentMode: "react",
  archives: [
    {
      conversationId: "conv_1778307810068_5jot5q",
      fileName: "conv_1778307810068_5jot5q.json",
      path: "/data/notebook/runs/chats/conv_1778307810068_5jot5q.json",
      title: "查一下",
      updatedAt: Date.now(),
      messageCount: 2,
    },
  ],
  archiveStatus: "ready",
};

const checks = [
  ["plugin settings", "https://leoiu.local/siyuan-addon/plugin-settings.schema.json", settings],
  ["chat session", "https://leoiu.local/siyuan-addon/chat-session.schema.json", chatSession],
];

for (const [label, schemaId, value] of checks) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) throw new Error(`Missing schema: ${schemaId}`);
  if (!validate(value)) {
    console.error(`${label} contract failed`);
    console.error(validate.errors);
    process.exit(1);
  }
  console.log(`ok ${label}`);
}
