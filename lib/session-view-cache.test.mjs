import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  SESSION_VIEW_CACHE_LIMIT,
  clearSessionViewCache,
  deleteSessionViewSnapshot,
  getSessionViewSnapshot,
  setSessionViewSnapshot,
  updateSessionViewUi,
} = await jiti.import("./session-view-cache.ts");

function snapshot(id) {
  return {
    data: { sessionId: id },
    messages: [{ role: "user", content: id }],
    entryIds: [`entry-${id}`],
    activeLeafId: `leaf-${id}`,
    cachedAt: Date.now(),
  };
}

test.beforeEach(() => clearSessionViewCache());

test("stores session data and preserves UI state across refreshes", () => {
  setSessionViewSnapshot("one", { ...snapshot("one"), revision: 'W/"revision"' });
  updateSessionViewUi("one", { scrollTop: 240, visibleCount: 100, atTail: false });
  setSessionViewSnapshot("one", { ...snapshot("one"), cachedAt: Date.now() + 1 });

  const cached = getSessionViewSnapshot("one");
  assert.equal(cached?.revision, 'W/"revision"');
  assert.deepEqual(cached?.ui, {
    scrollTop: 240,
    visibleCount: 100,
    atTail: false,
  });
});

test("evicts the least recently used session", () => {
  for (let index = 0; index < SESSION_VIEW_CACHE_LIMIT; index += 1) {
    setSessionViewSnapshot(`session-${index}`, snapshot(`session-${index}`));
  }

  // Promote session-0 so session-1 becomes the oldest entry.
  assert.ok(getSessionViewSnapshot("session-0"));
  setSessionViewSnapshot("newest", snapshot("newest"));

  assert.equal(getSessionViewSnapshot("session-1"), undefined);
  assert.ok(getSessionViewSnapshot("session-0"));
  assert.ok(getSessionViewSnapshot("newest"));
});

test("deletes invalid snapshots", () => {
  setSessionViewSnapshot("gone", snapshot("gone"));
  deleteSessionViewSnapshot("gone");
  assert.equal(getSessionViewSnapshot("gone"), undefined);
});
