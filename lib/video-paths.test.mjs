import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  extractLocalMediaPaths,
  extractLocalVideoPaths,
  MAX_MESSAGE_VIDEO_PREVIEWS,
} = await jiti.import("./media-paths.ts");

test("extracts absolute Windows and POSIX video paths", () => {
  assert.deepEqual(
    extractLocalVideoPaths("D:\\comfyui\\ComfyUI\\output\\video\\xin_paradigm\\anime_sneeze_00001_.mp4"),
    ["D:/comfyui/ComfyUI/output/video/xin_paradigm/anime_sneeze_00001_.mp4"],
  );
  assert.deepEqual(
    extractLocalVideoPaths("see /tmp/clips/demo.webm please"),
    ["/tmp/clips/demo.webm"],
  );
});

test("extracts Windows image paths from inline code", () => {
  assert.deepEqual(
    extractLocalMediaPaths("文件： `C:\\Users\\albin\\Pictures\\yy\\zimage_out\\turbo_00010_.png`"),
    [{
      filePath: "C:/Users/albin/Pictures/yy/zimage_out/turbo_00010_.png",
      kind: "image",
    }],
  );
});

test("resolves relative video paths against cwd and skips markdown targets", () => {
  assert.deepEqual(
    extractLocalVideoPaths("generated ./out/shot.mov", "/home/me/project"),
    ["/home/me/project/out/shot.mov"],
  );
  assert.deepEqual(
    extractLocalVideoPaths("![clip](/tmp/clips/demo.mp4)", "/home/me/project"),
    [],
  );
});

test("deduplicates and caps extracted video paths", () => {
  const repeated = "/tmp/a.mp4 /tmp/A.mp4 /tmp/b.mkv";
  assert.deepEqual(extractLocalVideoPaths(repeated), ["/tmp/a.mp4", "/tmp/b.mkv"]);

  const many = Array.from({ length: MAX_MESSAGE_VIDEO_PREVIEWS + 3 }, (_, i) => `/tmp/clip-${i}.mp4`).join(" ");
  assert.equal(extractLocalVideoPaths(many).length, MAX_MESSAGE_VIDEO_PREVIEWS);
});
