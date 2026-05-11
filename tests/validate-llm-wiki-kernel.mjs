import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

const checks = [
  ["llm wiki model settings", "src/models/llm-wiki.ts", "export interface LlmWikiSettings"],
  ["five layer path classifier", "src/models/llm-wiki.ts", "classifyLlmWikiPath"],
  ["agents layer", "src/models/llm-wiki.ts", "\"agents\""],
  ["wiki layer", "src/models/llm-wiki.ts", "\"wiki\""],
  ["raw layer", "src/models/llm-wiki.ts", "\"raw\""],
  ["skills layer", "src/models/llm-wiki.ts", "\"skills\""],
  ["runs layer", "src/models/llm-wiki.ts", "\"runs\""],
  ["default auto safe", "src/models/llm-wiki.ts", "writeMode: LLM_WIKI_SAFE_WRITE_MODE"],
  ["settings persisted", "src/models/settings.ts", "llmWiki: LlmWikiSettings"],
  ["settings normalized", "src/services/settings-store.ts", "normalizeLlmWikiSettings"],
  ["settings setter", "src/services/settings-store.ts", "setLlmWikiSettings"],
  ["settings ui section", "src/ui/settings-modal.ts", "LLM-Wiki 知识库"],
  ["settings ui write mode", "src/ui/settings-modal.ts", "自动新增/更新，阻止高风险操作"],
  ["settings contract", "specs/001-side-ai-chat/contracts/plugin-settings.schema.json", "\"llmWiki\""],
  ["runtime content model", "src/models/chat.ts", "runtimeContent"],
  ["runtime content contract", "specs/001-side-ai-chat/contracts/chat-session.schema.json", "\"runtimeContent\""],
  ["siyuan notebook API", "src/services/siyuan-knowledge-store.ts", "/api/notebook/lsNotebooks"],
  ["siyuan query API", "src/services/siyuan-knowledge-store.ts", "/api/query/sql"],
  ["siyuan create doc API", "src/services/siyuan-knowledge-store.ts", "/api/filetree/createDocWithMd"],
  ["siyuan hpath API", "src/services/siyuan-knowledge-store.ts", "/api/filetree/getIDsByHPath"],
  ["siyuan export API", "src/services/siyuan-knowledge-store.ts", "/api/export/exportMdContent"],
  ["policy loader", "src/services/llm-wiki-kernel.ts", "class PolicyLoader"],
  ["skill registry", "src/services/llm-wiki-kernel.ts", "class SkillRegistry"],
  ["skill registry requires entry document", "src/services/siyuan-knowledge-store.ts", "skillEntryPath"],
  ["context assembler", "src/services/llm-wiki-kernel.ts", "class ContextAssembler"],
  ["mcp tool policy", "src/services/llm-wiki-kernel.ts", "class McpToolPolicy"],
  ["write ledger", "src/services/llm-wiki-kernel.ts", "class WriteLedger"],
  ["kernel boundary", "src/services/llm-wiki-kernel.ts", "export class LlmWikiKernel"],
  ["ordinary query avoids raw", "src/services/llm-wiki-kernel.ts", "isRawEvidenceIntent(request.userGoal)"],
  ["destructive blocked", "src/services/llm-wiki-kernel.ts", "DESTRUCTIVE_ACTIONS"],
  ["ledger path", "src/services/llm-wiki-kernel.ts", "/runs/ledger/"],
  ["kernel prompt context", "src/services/llm-wiki-kernel.ts", "LLM_WIKI_CONTEXT_HEADER"],
  ["chat kernel option", "src/services/chat-service.ts", "llmWikiKernel?: LlmWikiKernel"],
  ["chat prompt assembly", "src/services/chat-service.ts", "assemblePrompt"],
  ["visible prompt separation", "src/services/chat-service.ts", "visibleUserPrompt"],
  ["runtime prompt separation", "src/services/chat-service.ts", "toRuntimeMessage(userMessage)"],
  ["write intent needs tools guard", "src/services/chat-service.ts", "保存|记录|写入|创建|新增|更新|归档|导入|整理|蒸馏"],
  ["tool filtering", "src/services/chat-service.ts", "filterTools"],
  ["continuation tool filtering", "src/services/chat-service.ts", "toolsForRuntimeMessages"],
  ["tool authorization", "src/services/chat-service.ts", "authorizeToolCall"],
  ["late tool result guard", "src/services/chat-service.ts", "this.session.generationId !== generationId"],
  ["kernel write success guard", "src/services/agent-runtime.ts", "isLlmWikiRuntimeGoal(goal)"],
  ["ledger recording", "src/services/chat-service.ts", "recordToolOperation"],
  ["plugin wiring", "src/index.ts", "new LlmWikiKernel"],
  ["spec file", "specs/003-llm-wiki-knowledge-kernel/spec.md", "LLM-Wiki Knowledge Kernel"],
  ["tasks file", "specs/003-llm-wiki-knowledge-kernel/tasks.md", "Manual Acceptance Checklist"],
];

const pathCases = [
  ["/LLM-Wiki/AGENTS", "agents"],
  ["/LLM-Wiki/wiki/index", "wiki"],
  ["/LLM-Wiki/raw/system/product", "raw"],
  ["/LLM-Wiki/skills/auto-ingest/SKILL", "skills"],
  ["/LLM-Wiki/runs/ledger/2026-05-11/op", "runs"],
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

const model = read("src/models/llm-wiki.ts");
for (const [path, layer] of pathCases) {
  const hasCase =
    (layer === "agents" && model.includes('hpath === "/AGENTS"')) ||
    (layer !== "agents" && model.includes(`hpath === "/${layer}"`));
  if (!hasCase) {
    console.error(`missing path classifier case for ${path} -> ${layer}`);
    failed = true;
  } else {
    console.log(`ok path classifier ${path} -> ${layer}`);
  }
}

if (failed) process.exit(1);
