import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { extractLocalMediaPaths } = await jiti.import("./media-paths.ts");

test("extracts ordinary local media paths", () => {
  assert.deepEqual(
    extractLocalMediaPaths("C:\\renders\\output.mp4 /tmp/still.png"),
    [
      { filePath: "C:/renders/output.mp4", kind: "video" },
      { filePath: "/tmp/still.png", kind: "image" },
    ],
  );
});

test("does not auto-preview network, namespace, or reserved device paths", () => {
  assert.deepEqual(extractLocalMediaPaths("\\\\server\\share\\output.mp4"), []);
  assert.deepEqual(extractLocalMediaPaths("\\\\?\\C:\\renders\\output.mp4"), []);
  assert.deepEqual(extractLocalMediaPaths("\\\\.\\C:\\renders\\output.mp4"), []);
  assert.deepEqual(extractLocalMediaPaths("//?/C:/renders/output.mp4"), []);
  assert.deepEqual(extractLocalMediaPaths("\\\\?/C:/renders/output.mp4"), []);
  assert.deepEqual(extractLocalMediaPaths("//?\\C:\\renders\\output.mp4"), []);
  assert.deepEqual(extractLocalMediaPaths("C:\\renders\\NUL.mp4"), []);
  assert.deepEqual(extractLocalMediaPaths("C:\\renders\\CON.png"), []);
  assert.deepEqual(extractLocalMediaPaths("C:\\renders\\COM1.mp4"), []);
  assert.deepEqual(extractLocalMediaPaths("/workspace/pi-web/NUL.mp4"), []);
});
