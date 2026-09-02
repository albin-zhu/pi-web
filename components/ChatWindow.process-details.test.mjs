import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

test("keeps strict artifact cards outside collapsed process details", () => {
  assert.match(source, /const artifactProcessIndices = processIndices\.filter/);
  assert.match(source, /!isArtifactBundleMessage\(messages\[processIdx\]\)/);
  assert.match(source, /for \(const artifactIdx of artifactProcessIndices\)/);
});

test("binds rerun actions to the message session and branch", () => {
  assert.match(source, /const artifactActionTargetRef = useRef/);
  assert.match(source, /sourceSessionId !== target\.sessionId \|\| sourceLeafId !== target\.leafId/);
  assert.match(source, /artifactSourceSessionId === artifactActionTargetRef\.current\.sessionId/);
  assert.match(source, /artifactSourceLeafId === artifactActionTargetRef\.current\.leafId/);
});
