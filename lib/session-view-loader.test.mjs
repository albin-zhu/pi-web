import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  clearSessionViewLoadersForTest,
  loadSessionView,
  prefetchSessionView,
} = await jiti.import("./session-view-loader.ts");
const {
  clearSessionViewCache,
  getSessionViewSnapshot,
} = await jiti.import("./session-view-cache.ts");

const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  clearSessionViewLoadersForTest();
  clearSessionViewCache();
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

function sessionData(id) {
  return {
    sessionId: id,
    leafId: "leaf",
    context: {
      messages: [{ role: "user", content: "hello" }],
      entryIds: ["entry"],
    },
  };
}

test("coalesces a hover prefetch and foreground session load", async () => {
  let requests = 0;
  let release;
  globalThis.fetch = async () => {
    requests += 1;
    await new Promise((resolve) => { release = resolve; });
    return new Response(JSON.stringify(sessionData("shared")), {
      status: 200,
      headers: { "Content-Type": "application/json", ETag: 'W/"shared"' },
    });
  };

  const prefetched = prefetchSessionView("shared");
  const foreground = loadSessionView("shared");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests, 1);
  release();
  const result = await foreground;
  await prefetched;

  assert.equal(result.status, "loaded");
  assert.equal(getSessionViewSnapshot("shared")?.revision, 'W/"shared"');
});

test("sends a cached revision and accepts an unchanged response", async () => {
  let requestHeaders;
  globalThis.fetch = async (_url, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(null, { status: 304 });
  };

  const result = await loadSessionView("cached", 'W/"revision"');
  assert.equal(requestHeaders.get("if-none-match"), 'W/"revision"');
  assert.deepEqual(result, { status: "unchanged" });
});

test("uses the bounded tail-page request", async () => {
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify(sessionData("tail")), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await loadSessionView("tail");
  assert.match(requestedUrl, /deferThinking=1/);
  assert.match(requestedUrl, /deferMedia=1/);
  assert.match(requestedUrl, /limit=100/);
});
