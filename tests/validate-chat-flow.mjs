import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

const checks = [
  ["settings default includes kernel", "src/models/settings.ts", "llmWiki: defaultLlmWikiSettings()"],
  ["settings modal exposes kernel", "src/ui/settings-modal.ts", "renderLlmWikiSection"],
  ["plugin wires kernel", "src/index.ts", "llmWikiKernel: this.llmWikiKernel"],
  ["kernel context is hidden", "src/services/chat-service.ts", "runtimeContent: runtimePrompt === visiblePrompt ? undefined : runtimePrompt"],
  ["visible prompt is separate", "src/services/chat-service.ts", "private visibleUserPrompt"],
  ["runtime message passed to agent", "src/services/chat-service.ts", "toRuntimeMessage(userMessage)"],
  ["continuation restores runtime message", "src/services/chat-service.ts", "toRuntimeMessage(userMessage), assistantMessage"],
  ["archive stores visible content only", "src/services/siyuan-chat-archive.ts", "content: message.content"],
  ["archive does not persist runtime content", "src/services/siyuan-chat-archive.ts", "interface ArchivedChatMessage"],
  ["archive sql fallback", "src/services/siyuan-chat-archive.ts", "findArchiveDocId"],
  ["archive startup skip stale entry", "src/services/chat-service.ts", "loadFirstAvailableArchive"],
  ["ui renders visible content", "src/ui/chat-dock.ts", "message.content"],
  ["tool filtering before runtime", "src/services/chat-service.ts", "const tools = this.toolsForPrompt(runtimePrompt)"],
  ["continuation uses matching tool filter", "src/services/chat-service.ts", "toolsForRuntimeMessages(runtimeMessages)"],
  ["tool call policy before dispatch", "src/services/chat-service.ts", "authorizeToolCall(tool, args)"],
  ["late tool result ignored after stop", "src/services/chat-service.ts", "if (this.session.generationId !== generationId) return;"],
  ["react step keeps stop available", "src/services/chat-service.ts", "private appendReActStep"],
  ["mcp discovery dedupes pending", "src/services/mcp-service.ts", "pendingDiscoveries"],
  ["mcp close clears tools", "src/services/mcp-service.ts", "this.tools.delete(serverId)"],
  ["write ledger records mutations", "src/services/llm-wiki-kernel.ts", "recordToolOperation"],
  ["ledger goes to runs", "src/services/llm-wiki-kernel.ts", "/runs/ledger/"],
  ["no tools guard covers writes", "src/services/chat-service.ts", "保存|记录|写入|创建|新增|更新|归档|导入|整理|蒸馏"],
  ["llm adapter knows kernel context", "src/adapters/llm-chat-completions.ts", "LLM-WIKI KNOWLEDGE KERNEL CONTEXT"],
  ["runtime intent avoids context pollution", "src/services/agent-runtime.ts", "runtimeUserIntent"],
  ["kernel writes require mutation", "src/services/agent-runtime.ts", "isLlmWikiRuntimeGoal(goal)"],
  ["skill palette requires SKILL entry", "src/services/siyuan-skill-index.ts", "hasSkillEntry"],
  ["kernel registry requires SKILL entry", "src/services/siyuan-knowledge-store.ts", "skillEntryPath"],
];

let failed = false;
for (const [label, file, expected] of checks) {
  const text = read(file);
  if (!text.includes(expected)) {
    console.error(`missing ${label}: ${expected} in ${file}`);
    failed = true;
  } else {
    console.log(`ok ${label}`);
  }
}

const archiveStore = read("src/services/siyuan-chat-archive.ts");
if (/runtimeContent/.test(archiveStore)) {
  console.error("archive store must not persist runtimeContent");
  failed = true;
} else {
  console.log("ok archive excludes runtimeContent");
}

const chatService = read("src/services/chat-service.ts");
const appendReActStep = chatService.match(/private appendReActStep[\s\S]*?private startToolCall/)?.[0] || "";
if (/isGenerating:\s*false/.test(appendReActStep)) {
  console.error("appendReActStep must not mark the session as not generating before the runtime finishes");
  failed = true;
} else {
  console.log("ok react step preserves generating state");
}

if (failed) process.exit(1);
