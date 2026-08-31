import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  SESSION_MESSAGE_PAGE_MAX,
  paginateSessionContext,
  parseSessionMessageLimit,
} = await jiti.import("./session-pagination.ts");

function context(count) {
  return {
    messages: Array.from({ length: count }, (_, index) => ({ role: "user", content: `message-${index}` })),
    entryIds: Array.from({ length: count }, (_, index) => `entry-${index}`),
    thinkingLevel: "off",
    model: null,
  };
}

test("returns the tail page with aligned entry ids", () => {
  const page = paginateSessionContext(context(12), 5);
  assert.deepEqual(page.entryIds, ["entry-7", "entry-8", "entry-9", "entry-10", "entry-11"]);
  assert.deepEqual(page.messages.map((message) => message.content), [
    "message-7", "message-8", "message-9", "message-10", "message-11",
  ]);
  assert.equal(page.totalMessages, 12);
  assert.equal(page.startIndex, 7);
  assert.equal(page.hasMore, true);
});

test("loads the page immediately before a stable entry cursor", () => {
  const page = paginateSessionContext(context(12), 4, "entry-7");
  assert.deepEqual(page.entryIds, ["entry-3", "entry-4", "entry-5", "entry-6"]);
  assert.equal(page.startIndex, 3);
  assert.equal(page.hasMore, true);
});

test("falls back to the latest page when a stale cursor is absent", () => {
  const page = paginateSessionContext(context(6), 2, "deleted-entry");
  assert.deepEqual(page.entryIds, ["entry-4", "entry-5"]);
});

test("keeps legacy full-context responses when no limit is requested", () => {
  const original = context(3);
  const page = paginateSessionContext(original, null);
  assert.deepEqual(page.messages, original.messages);
  assert.equal(page.hasMore, false);
  assert.equal(page.startIndex, 0);
});

test("validates and caps requested page sizes", () => {
  assert.equal(parseSessionMessageLimit(null), null);
  assert.equal(parseSessionMessageLimit("0"), null);
  assert.equal(parseSessionMessageLimit("1.5"), null);
  assert.equal(parseSessionMessageLimit("50"), 50);
  assert.equal(parseSessionMessageLimit("999999"), SESSION_MESSAGE_PAGE_MAX);
});
