import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  SESSION_RESPONSE_CACHE_LIMIT,
  clearSessionResponseCache,
  createSessionRevision,
  getCachedSessionResponse,
  requestMatchesRevision,
  setCachedSessionResponse,
} = await jiti.import("./session-response-cache.ts");

test.beforeEach(() => clearSessionResponseCache());

test("creates stable scoped revisions from file metadata", () => {
  const version = { size: 12345, mtimeMs: 123456.75 };
  const first = createSessionRevision(version, "full:1:1");
  assert.equal(createSessionRevision(version, "full:1:1"), first);
  assert.notEqual(createSessionRevision({ ...version, size: version.size + 1 }, "full:1:1"), first);
  assert.notEqual(createSessionRevision(version, "context:leaf:1:1"), first);
  assert.match(first, /^W\/"pi-session-[A-Za-z0-9-]+"$/);
});

test("matches conditional request lists and wildcard validators", () => {
  const revision = createSessionRevision({ size: 1, mtimeMs: 2 }, "full");
  assert.equal(requestMatchesRevision(null, revision), false);
  assert.equal(requestMatchesRevision('"other", ' + revision, revision), true);
  assert.equal(requestMatchesRevision("*", revision), true);
  assert.equal(requestMatchesRevision('W/"stale"', revision), false);
});

test("returns only responses for the current revision", () => {
  setCachedSessionResponse("session", "rev-1", { value: 1 });
  assert.deepEqual(getCachedSessionResponse("session", "rev-1"), { value: 1 });
  assert.equal(getCachedSessionResponse("session", "rev-2"), undefined);
});

test("evicts the least recently used response", () => {
  for (let index = 0; index < SESSION_RESPONSE_CACHE_LIMIT; index += 1) {
    setCachedSessionResponse(`session-${index}`, "revision", index);
  }
  assert.equal(getCachedSessionResponse("session-0", "revision"), 0);
  setCachedSessionResponse("newest", "revision", "new");
  assert.equal(getCachedSessionResponse("session-1", "revision"), undefined);
  assert.equal(getCachedSessionResponse("session-0", "revision"), 0);
});
