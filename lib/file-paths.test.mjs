import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFilePathFromApiSegments,
  encodeFilePathForApi,
  isNetworkOrDeviceFileApiUrl,
  isNetworkOrDeviceFilePath,
  isUnsafeWindowsPathSegment,
  isWindowsDeviceFilePath,
} from "./file-paths.ts";

function decoded(encoded) {
  return decodeFilePathFromApiSegments(encoded.split("/").map(decodeURIComponent));
}

test("file API paths round-trip POSIX and Windows drive roots", () => {
  assert.equal(decoded(encodeFilePathForApi("/var/renders/output.png")), "/var/renders/output.png");
  assert.equal(decoded(encodeFilePathForApi("C:\\renders\\output.png")), "C:/renders/output.png");
});

test("file API paths preserve UNC server and share prefixes", () => {
  const encoded = encodeFilePathForApi("\\\\render-box\\comfy-output\\clip.mp4");
  assert.match(encoded, /^__pi_unc_path_v1__\//);
  assert.equal(decoded(encoded), "//render-box/comfy-output/clip.mp4");
});

test("file API path markers cannot collide with ordinary POSIX roots", () => {
  const original = "/__pi_unc_path_v1__/ordinary/file.txt";
  assert.equal(decoded(encodeFilePathForApi(original)), original);
});

test("identifies network and Windows device paths before implicit file access", () => {
  assert.equal(isNetworkOrDeviceFilePath("\\\\server\\share\\clip.mp4"), true);
  assert.equal(isNetworkOrDeviceFilePath("C:\\renders\\clip.mp4"), false);
  assert.equal(isWindowsDeviceFilePath("\\\\.\\pipe\\comfy"), true);
  assert.equal(isWindowsDeviceFilePath("\\\\?\\C:\\renders\\clip.mp4"), true);
  assert.equal(isWindowsDeviceFilePath("\\\\server\\share\\clip.mp4"), false);
  assert.equal(isWindowsDeviceFilePath("C:\\NUL"), true);
  assert.equal(isWindowsDeviceFilePath("C:\\temp\\CON.txt"), true);
  assert.equal(isWindowsDeviceFilePath("C:\\renders\\COM1.mp4"), true);
  assert.equal(isWindowsDeviceFilePath("C:\\renders\\lpt9 .preview.png"), true);
  assert.equal(isWindowsDeviceFilePath("C:\\renders\\AUX:stream"), true);
  assert.equal(isWindowsDeviceFilePath("C:\\renders\\safe.png:stream"), true);
  assert.equal(isWindowsDeviceFilePath("C:\\renders\\safe.png."), true);
  assert.equal(isWindowsDeviceFilePath("C:\\renders\\safe.png "), true);
  assert.equal(isWindowsDeviceFilePath("C:\\renders\\console.png"), false);
  assert.equal(isWindowsDeviceFilePath("/tmp/NUL"), false);
  assert.equal(isWindowsDeviceFilePath("/workspace/NUL", true), true);
  assert.equal(isWindowsDeviceFilePath("\\workspace\\CON.txt", true), true);
  assert.equal(isWindowsDeviceFilePath("/workspace/safe.png:stream", true), true);
  assert.equal(isUnsafeWindowsPathSegment("NUL.txt"), true);
  assert.equal(isUnsafeWindowsPathSegment("safe.png:stream"), true);
  assert.equal(isUnsafeWindowsPathSegment("safe.png."), true);
  assert.equal(isUnsafeWindowsPathSegment("safe.png "), true);
  assert.equal(isUnsafeWindowsPathSegment("safe.png"), false);
  assert.equal(isNetworkOrDeviceFileApiUrl("/api/files/__pi_unc_path_v1__/server/share/clip.mp4"), true);
  assert.equal(isNetworkOrDeviceFileApiUrl("/api/files/C%3A/NUL?type=read"), true);
  assert.equal(isNetworkOrDeviceFileApiUrl("/api/files/C%3A/temp/CON.txt?type=read"), true);
  assert.equal(isNetworkOrDeviceFileApiUrl("/api/files/workspace/NUL?type=read", true), true);
  assert.equal(isNetworkOrDeviceFileApiUrl("/api/files/workspace/safe.png%3Astream?type=read", true), true);
  assert.equal(isNetworkOrDeviceFileApiUrl("/api/files/C%3A/renders/clip.mp4"), false);
});
