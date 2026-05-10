# Quickstart: ReAct Agent Runtime Manual Validation

## Preconditions

- At least one valid LLM profile is configured.
- At least one Siyuan MCP server is enabled and tools have been discovered for MCP scenarios.
- The plugin has been rebuilt and copied to the active Siyuan plugin directory.

## Manual Scenarios

1. Ask a normal no-tool question.
   - Expected: AI answers normally and the assistant message includes a collapsed "思考过程" block.

2. Ask "当前有哪些笔记本" without mentioning MCP.
   - Expected: AI prioritizes Siyuan MCP tools and no standalone tool result/status bubble appears.

3. Expand "思考过程".
   - Expected: The expanded block shows rounds with Thought, Action, and Observation.

4. Copy an AI reply that has a ReAct trace.
   - Expected: The copied text includes the thinking process and the final answer.

5. Trigger a tool call.
   - Expected: Observation shows a concise summary, not full raw JSON.

6. Use a controlled model/prompt that keeps requesting tools for more than 10 rounds.
   - Expected: The assistant pauses and shows "已超过默认思考最大轮次，是否继续".

7. Click red "继续".
   - Expected: Generation resumes from the same assistant message and continues the trace.

8. Stop during generation.
   - Expected: The current turn is marked stopped and continuation is cleared.

9. While waiting to continue, type a new prompt and send.
   - Expected: The previous continuation is abandoned and a new ReAct turn starts.
