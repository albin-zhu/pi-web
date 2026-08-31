import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { summarizeSessionMessages } = await jiti.import("./session-message-stats.ts");

test("summarizes complete context independently of the delivered page", () => {
  const summary = summarizeSessionMessages([
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: [{ type: "text", text: "working" }, { type: "toolCall", id: "call", name: "read", arguments: {} }],
      usage: {
        input: 10,
        output: 4,
        cacheRead: 3,
        cacheWrite: 2,
        totalTokens: 19,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 },
      },
    },
    { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "done" }], isError: false },
  ]);

  assert.deepEqual(summary, {
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 1,
    toolResults: 1,
    totalMessages: 3,
    tokens: { input: 10, output: 4, cacheRead: 3, cacheWrite: 2, total: 19 },
    cost: 0.25,
  });
});
