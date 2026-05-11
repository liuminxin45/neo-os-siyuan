import fs from "node:fs";

const checks = [
  ["agent mode model", "src/models/agent.ts", "plan-and-execute"],
  ["react round limit", "src/models/agent.ts", "REACT_SEGMENT_ROUNDS = 10"],
  ["agent runtime", "src/services/agent-runtime.ts", "class AgentRuntime"],
  ["react runtime history", "src/services/agent-runtime.ts", "formatReActHistoryEntry"],
  ["react argument repair", "src/services/agent-runtime.ts", "repairToolArguments"],
  ["react final thought", "src/services/agent-runtime.ts", "根据已有 Observation 整理最终回答"],
  ["inventory args avoids help", "src/services/agent-runtime.ts", "suggestedInventoryArgs"],
  ["duplicate guard keeps success", "src/services/agent-runtime.ts", "previous && result.status === \"stopped\""],
  ["root listing expansion", "src/services/agent-runtime.ts", "repeatedRootListingArgs"],
  ["duplicate guard finalizer", "src/services/agent-runtime.ts", "stepHitDuplicateGuard"],
  ["listing finalizer", "src/services/agent-runtime.ts", "shouldFinalizeAfterListing"],
  ["round limit forced final", "src/services/agent-runtime.ts", "不要再要求用户点击继续"],
  ["schema prompt avoids help", "src/adapters/llm-chat-completions.ts", "除非用户明确询问工具用法，否则不要先调用 help"],
  ["notebook list permission prompt", "src/adapters/llm-chat-completions.ts", "notebook.list 只能证明笔记本存在"],
  ["repair system prompt", "src/adapters/llm-chat-completions.ts", "systemPrompt"],
  ["react history continuation", "src/models/agent.ts", "reactHistory"],
  ["continuation state", "src/services/chat-service.ts", "waiting-continue"],
  ["continue button", "src/ui/chat-dock.ts", "继续"],
  ["react trace UI", "src/ui/chat-dock.ts", "思考过程"],
  ["pause hint", "src/models/agent.ts", "已超过默认思考最大轮次"],
  ["settings default", "src/models/settings.ts", "agentMode: \"react\""],
  ["memory setting type", "src/models/settings.ts", "MaxMemoryTurns = 5 | 10 | 20 | 30"],
  ["memory setting default", "src/models/settings.ts", "DEFAULT_MAX_MEMORY_TURNS"],
  ["memory setting store setter", "src/services/settings-store.ts", "setMaxMemoryTurns"],
  ["memory setting UI", "src/ui/settings-modal.ts", "最大记忆对话轮次"],
  ["chat memory option", "src/services/chat-service.ts", "getMaxMemoryTurns"],
  ["chat memory pair builder", "src/services/chat-service.ts", "memoryMessages"],
  ["continuation runtime history", "src/services/chat-service.ts", "continuationRuntimeMessages"],
  ["abandon unfinished continuation", "src/services/chat-service.ts", "abandonContinuation"],
  ["skill index model", "src/models/skill.ts", "SkillIndexItem"],
  ["skill index reader", "src/services/siyuan-skill-index.ts", "LLM-Wiki"],
  ["skill full source path", "src/services/siyuan-skill-index.ts", "fullNotebookPath"],
  ["skill summary SQL", "src/services/siyuan-skill-index.ts", "SELECT content"],
  ["skill index ignores non-entry docs", "src/services/siyuan-skill-index.ts", "hasSkillEntry"],
  ["slash skill palette", "src/ui/chat-dock.ts", "siyuan-addon-skill-palette"],
  ["skill send wrapping", "src/services/chat-service.ts", "已选 skill"],
  ["skill MCP boundary prompt", "src/adapters/llm-chat-completions.ts", "若上下文已提供完整 SKILL 文档"],
  ["skill write completion guard", "src/services/agent-runtime.ts", "requiresSuccessfulMutation"],
  ["runtime intent extraction", "src/services/agent-runtime.ts", "runtimeUserIntent"],
  ["kernel write completion guard", "src/services/agent-runtime.ts", "isLlmWikiRuntimeGoal(goal)"],
  ["skill mutation finalizer", "src/services/agent-runtime.ts", "stepHasSuccessfulMutation"],
  ["skill directory write guard", "src/services/agent-runtime.ts", "path 不能以 / 结尾"],
  ["skill write content guard", "src/services/agent-runtime.ts", "写入内容缺少用户目标中的关键信息"],
  ["skill write success wording guard", "src/services/chat-service.ts", "只有观察到成功的 MCP 写入类调用后"],
  ["mutation ledger formatter", "src/services/agent-runtime.ts", "formatMutationLedger"],
  ["mutation ledger finalizer", "src/services/agent-runtime.ts", "finalizeAgentContent"],
  ["mutation ledger title", "src/services/agent-runtime.ts", "## 实际变更清单"],
  ["mutation ledger prompt", "src/adapters/llm-chat-completions.ts", "自动追加固定格式的“实际变更清单”"],
  ["chat archive store", "src/services/siyuan-chat-archive.ts", "LLM-Wiki"],
  ["chat archive runs path", "src/services/siyuan-chat-archive.ts", "runs"],
  ["chat archive save", "src/services/chat-service.ts", "saveCurrentSession"],
  ["chat archive stable order", "src/services/chat-service.ts", "mergeArchiveSummary"],
  ["chat archive created sort", "src/services/siyuan-chat-archive.ts", "compareChatArchives"],
  ["chat archive load", "src/services/chat-service.ts", "loadArchives"],
  ["chat archive stale skip", "src/services/chat-service.ts", "loadFirstAvailableArchive"],
  ["chat archive switch", "src/services/chat-service.ts", "switchArchive"],
  ["chat archive delete", "src/services/chat-service.ts", "deleteArchive"],
  ["chat archive SQL fallback", "src/services/siyuan-chat-archive.ts", "findArchiveDocId"],
  ["chat archive missing file guard", "src/services/siyuan-chat-archive.ts", "聊天存档文件不存在"],
  ["chat archive picker", "src/ui/chat-dock.ts", "siyuan-addon-session-picker"],
  ["chat references model", "src/models/chat.ts", "ChatReference"],
  ["chat references UI", "src/ui/chat-dock.ts", "renderReferences"],
  ["document opener service", "src/services/siyuan-document-opener.ts", "openTab"],
  ["document opener hpath lookup", "src/services/siyuan-document-opener.ts", "getIDsByHPath"],
  ["markdown wiki links", "src/ui/markdown.ts", "wikiLink"],
  ["markdown document click", "src/ui/markdown.ts", "onOpenDocument"],
  ["document link prompt", "src/adapters/llm-chat-completions.ts", "[[文档标题]]"],
];

let failed = false;
for (const [label, file, expected] of checks) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(expected)) {
    console.error(`missing ${label}: ${expected} in ${file}`);
    failed = true;
  } else {
    console.log(`ok ${label}`);
  }
}

if (failed) process.exit(1);
