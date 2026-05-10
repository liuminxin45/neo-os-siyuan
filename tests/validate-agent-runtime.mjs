import fs from "node:fs";

const checks = [
  ["agent mode model", "src/models/agent.ts", "plan-and-execute"],
  ["react round limit", "src/models/agent.ts", "REACT_SEGMENT_ROUNDS = 10"],
  ["agent runtime", "src/services/agent-runtime.ts", "class AgentRuntime"],
  ["react runtime history", "src/services/agent-runtime.ts", "formatReActHistoryEntry"],
  ["react argument repair", "src/services/agent-runtime.ts", "repairToolArguments"],
  ["react final thought", "src/services/agent-runtime.ts", "根据已有 Observation 整理最终回答"],
  ["repair system prompt", "src/adapters/llm-chat-completions.ts", "systemPrompt"],
  ["react history continuation", "src/models/agent.ts", "reactHistory"],
  ["continuation state", "src/services/chat-service.ts", "waiting-continue"],
  ["continue button", "src/ui/chat-dock.ts", "继续"],
  ["react trace UI", "src/ui/chat-dock.ts", "思考过程"],
  ["pause hint", "src/models/agent.ts", "已超过默认思考最大轮次"],
  ["settings default", "src/models/settings.ts", "agentMode: \"react\""],
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
