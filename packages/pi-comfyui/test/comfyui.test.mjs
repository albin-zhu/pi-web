import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import comfyUiExtension, {
  ARTIFACT_PROGRESS_ENTRY_CUSTOM_TYPE,
  buildPublishedBundle,
  bundleContent,
  bundleFromClientOutput,
  bundleFromClientProgress,
  extractJsonDocuments,
  inferArtifactKind,
} from "../extensions/comfyui.ts";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parseArtifactBundle } = await jiti.import("../../../lib/artifact-bundle.ts");

test("extractJsonDocuments ignores log prefixes and braces inside strings", () => {
  const values = extractJsonDocuments('job: running\n{"message":"keep {this}","downloaded":["D:\\\\out\\\\a.mp4"]}\n');
  assert.equal(values.length, 1);
  assert.deepEqual(values[0].downloaded, ["D:\\out\\a.mp4"]);
});

test("bundleFromClientOutput normalizes a downloaded H3 result", () => {
  const text = [
    "MiniMax H3 job run-123: completed",
    JSON.stringify({
      id: "run-123",
      status: "completed",
      generation: { seed: "18446744073709551615" },
      downloaded: ["C:\\renders\\one.mp4", "C:\\renders\\two.mp4"],
    }),
  ].join("\n");
  const bundle = bundleFromClientOutput(text, "python h3_client.py generate --wait", "C:\\work");
  assert.ok(bundle);
  assert.equal(bundle.schema, "pi.artifact-bundle/v1");
  assert.equal(bundle.status, "succeeded");
  assert.equal(bundle.workflow?.name, "MiniMax H3");
  assert.equal(bundle.workflow?.seed, "18446744073709551615");
  assert.deepEqual(bundle.artifacts.map((artifact) => artifact.kind), ["video", "video"]);
});

test("automatic publishing preserves an unsafe numeric seed exactly", () => {
  const text = '{"status":"completed","generation":{"seed":9223372036854775807},"downloaded":["C:\\\\renders\\\\seed.png"]}';
  const bundle = bundleFromClientOutput(text, "python zimage_client.py generate --wait", "C:\\work");

  assert.ok(bundle);
  assert.equal(bundle.workflow?.seed, "9223372036854775807");
});

test("artifact kind inference covers common ComfyUI output families", () => {
  assert.equal(inferArtifactKind("frame.webp"), "image");
  assert.equal(inferArtifactKind("clip.mp4"), "video");
  assert.equal(inferArtifactKind("voice.flac"), "audio");
  assert.equal(inferArtifactKind("mesh.glb"), "model3d");
  assert.equal(inferArtifactKind("prompt.txt"), "text");
  assert.equal(inferArtifactKind("legacy.tiff"), "file");
  assert.equal(inferArtifactKind("legacy.mpg"), "file");
  assert.equal(inferArtifactKind("workflow.bin"), "file");
});

test("published bundles conform to Pi Web's strict artifact protocol", () => {
  const emitted = buildPublishedBundle({
    runId: "run-protocol",
    status: "succeeded",
    title: "Protocol result",
    workflowName: "Z-Image Turbo",
    seed: "9007199254740993",
    completedAt: "2026-08-25T12:00:00.000Z",
    artifacts: [{ path: "C:\\renders\\still.png", mimeType: "image/png", width: 1024, height: 1024 }],
  }, "C:\\work");

  const parsed = parseArtifactBundle(emitted);
  assert.ok(parsed);
  assert.equal(parsed.artifacts[0].filename, "still.png");
  assert.equal(parsed.workflow?.seed, "9007199254740993");
});

test("publisher omits values that would make the strict Web protocol reject a bundle", () => {
  const emitted = buildPublishedBundle({
    runId: "run-normalized",
    status: "succeeded",
    startedAt: "not-a-timestamp",
    completedAt: "2026-08-25T12:00:00+08:00",
    artifacts: [{
      path: "C:\\renders\\still.png",
      mimeType: "not a mime type",
      width: 12.5,
      fps: 0,
    }],
  }, "C:\\work");

  const parsed = parseArtifactBundle(emitted);
  assert.ok(parsed);
  assert.equal(parsed.createdAt, undefined);
  assert.equal(parsed.completedAt, "2026-08-25T04:00:00.000Z");
  assert.equal(parsed.artifacts[0].mimeType, undefined);
  assert.equal(parsed.artifacts[0].width, undefined);
  assert.equal(parsed.artifacts[0].fps, undefined);
});

test("publisher refuses implicit UNC and Windows device artifacts", () => {
  const emitted = buildPublishedBundle({
    runId: "run-local-only",
    status: "succeeded",
    artifacts: [
      { path: "\\\\render-box\\share\\remote.png" },
      { path: "\\\\.\\pipe\\comfy" },
      { path: "C:\\renders\\NUL.mp4" },
      { path: "C:\\temp\\CON.txt" },
      { path: "C:\\renders\\COM1" },
      { path: "/workspace/NUL" },
      { path: "\\workspace\\CON.txt" },
      { path: "C:\\renders\\safe.png:stream" },
      { path: "C:\\renders\\safe.png." },
      { path: "C:\\renders\\safe.png " },
      { path: "C:\\renders\\local.png" },
    ],
  }, "C:\\work");

  assert.deepEqual(emitted.artifacts.map((artifact) => artifact.path), ["C:\\renders\\local.png"]);
});

test("bundleFromClientOutput preserves terminal failures without media", () => {
  const bundle = bundleFromClientOutput(
    JSON.stringify({ id: "failed-1", status: "failed", error: "Sampler ran out of memory" }),
    "python klein_client.py wait failed-1",
    "C:\\work",
  );

  assert.ok(bundle);
  assert.equal(bundle.status, "failed");
  assert.equal(bundle.artifacts.length, 0);
  assert.equal(bundle.error?.message, "Sampler ran out of memory");
});

test("automatic publishing preserves non-terminal client snapshots without declaring success", () => {
  const downloaded = ["C:\\renders\\preview.png"];
  const running = bundleFromClientOutput(
    JSON.stringify({ id: "running-1", status: "running", downloaded }),
    "python zimage_client.py status running-1",
    "C:\\work",
  );
  assert.ok(running);
  assert.equal(running.status, "running");
  assert.equal(running.progress?.message, "Generating in ComfyUI");
  assert.equal(bundleFromClientOutput(
    JSON.stringify({ id: "unknown-1", downloaded }),
    "python zimage_client.py status unknown-1",
    "C:\\work",
  ), null);
});

test("parses queued and indeterminate running progress from client stderr", () => {
  const queued = bundleFromClientProgress(
    "Z-Image Turbo job prompt-7: pending\n",
    "python zimage_client.py generate --wait",
    "C:\\work",
  );
  assert.ok(queued);
  assert.equal(queued.runId, "prompt-7");
  assert.equal(queued.status, "queued");

  const running = bundleFromClientProgress(
    "FLUX.2 Klein job prompt-7: in_progress\nPI_COMFYUI_PROGRESS {\"runId\":\"prompt-7\",\"status\":\"running\",\"message\":\"Sampling\",\"value\":8,\"max\":20,\"percent\":40}\n",
    "python klein_client.py generate --wait",
    "C:\\work",
  );
  assert.ok(running);
  assert.equal(running.status, "running");
  assert.equal(running.progress?.percent, 40);
  assert.equal(running.progress?.value, 8);
  assert.equal(running.progress?.max, 20);

  const untrusted = bundleFromClientProgress(
    "Z-Image Turbo job prompt-8: in_progress\nprompt says 99% and ratio 99 / 100\n",
    "python zimage_client.py generate --wait",
    "C:\\work",
  );
  assert.ok(untrusted);
  assert.equal(untrusted.progress?.percent, undefined);
  assert.equal(untrusted.progress?.value, undefined);
});

test("a failed bash result cannot be mislabeled as a successful bundle", () => {
  const bundle = bundleFromClientOutput(
    JSON.stringify({ id: "shell-failed", status: "completed", downloaded: ["C:\\renders\\partial.png"] }),
    "python zimage_client.py generate --wait",
    "C:\\work",
    true,
  );
  assert.ok(bundle);
  assert.equal(bundle.status, "failed");
  assert.equal(bundle.error?.message, "ComfyUI command failed");
});

test("publisher bounds structured fields and keeps custom-message content single-line", () => {
  const bundle = buildPublishedBundle({
    runId: `run\n${"x".repeat(900)}`,
    status: "succeeded",
    title: `title\u0000${"x".repeat(2_000)}`,
    summary: "first line\nsecond line",
    workflowName: "\u0000",
    seed: "7".repeat(400),
    artifacts: [
      { path: "C:\\renders\\safe.png", label: "label\nwith newline" },
      { path: "C:\\renders\\bad\npath.png" },
    ],
  }, "C:\\work");

  const parsed = parseArtifactBundle(bundle);
  assert.ok(parsed);
  assert.equal(parsed.artifacts.length, 1);
  assert.ok(parsed.runId.length <= 480);
  assert.ok(parsed.title.length <= 1_024);
  assert.equal(parsed.workflow?.seed.length, 256);
  const content = bundleContent(bundle);
  assert.match(content, /first line second line/);
  assert.doesNotMatch(content, /first line\nsecond line/);
  assert.doesNotMatch(content, /bad\npath/);
});

test("automatic publishing caps large downloaded lists before persistence", () => {
  const downloaded = Array.from({ length: 300 }, (_, index) => `C:\\renders\\output-${index}.png`);
  const bundle = bundleFromClientOutput(
    JSON.stringify({ id: "many-outputs", status: "completed", downloaded }),
    "python zimage_client.py generate --wait",
    "C:\\work",
  );
  assert.ok(bundle);
  assert.equal(bundle.artifacts.length, 64);
  assert.ok(parseArtifactBundle(bundle));
});

test("extension auto-publishes once for a recognized bash client result", async () => {
  const handlers = new Map();
  const entries = [];
  let tool;
  const pi = {
    registerTool(value) { tool = value; },
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
  };
  comfyUiExtension(pi);
  assert.equal(tool.name, "comfyui_publish");
  assert.equal(tool.parameters.properties.artifacts.minItems, undefined);

  const event = {
    toolName: "bash",
    isError: false,
    input: { command: "python zimage_client.py generate --wait" },
    content: [{ type: "text", text: JSON.stringify({ id: "z-1", status: "completed", downloaded: ["C:\\renders\\still.png"] }) }],
  };
  const ctx = { cwd: "C:\\work" };
  await handlers.get("tool_result")(event, ctx);
  await handlers.get("tool_result")(event, ctx);

  await assert.rejects(
    () => tool.execute("invalid", {
      status: "succeeded",
      artifacts: [{ path: "bad\npath.png" }],
    }, undefined, undefined, ctx),
    /No valid local ComfyUI artifact paths/,
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].customType, ARTIFACT_PROGRESS_ENTRY_CUSTOM_TYPE);
  assert.equal(entries[0].data.artifacts[0].kind, "image");
});

test("extension streams progress entries, updates its widget, and appends one terminal snapshot", () => {
  const handlers = new Map();
  const entries = [];
  const widgets = [];
  const pi = {
    registerTool() {},
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
  };
  comfyUiExtension(pi);
  const ctx = {
    cwd: "C:\\work",
    ui: { setWidget(key, lines) { widgets.push({ key, lines }); } },
  };
  const command = "python zimage_client.py generate --wait";

  handlers.get("tool_execution_start")({
    toolCallId: "tool-1",
    toolName: "bash",
    args: { command },
  }, ctx);
  handlers.get("tool_execution_update")({
    toolCallId: "tool-1",
    toolName: "bash",
    args: { command },
    partialResult: { content: [{ type: "text", text: "Z-Image Turbo job prompt-live: pending\n" }] },
  }, ctx);
  handlers.get("tool_execution_update")({
    toolCallId: "tool-1",
    toolName: "bash",
    args: { command },
    partialResult: { content: [{ type: "text", text: "Z-Image Turbo job prompt-live: pending\nZ-Image Turbo job prompt-live: in_progress\n" }] },
  }, ctx);
  handlers.get("tool_execution_update")({
    toolCallId: "tool-1",
    toolName: "bash",
    args: { command },
    partialResult: { content: [{ type: "text", text: "Z-Image Turbo job prompt-live: pending\nZ-Image Turbo job prompt-live: in_progress\n" }] },
  }, ctx);
  handlers.get("tool_result")({
    toolCallId: "tool-1",
    toolName: "bash",
    input: { command },
    isError: false,
    content: [{ type: "text", text: JSON.stringify({ id: "prompt-live", status: "completed", downloaded: ["C:\\renders\\live.png"] }) }],
  }, ctx);

  assert.equal(entries.length, 3);
  assert.ok(entries.every((entry) => entry.customType === ARTIFACT_PROGRESS_ENTRY_CUSTOM_TYPE));
  assert.deepEqual(entries.map((entry) => entry.data.status), ["queued", "running", "succeeded"]);
  assert.ok(entries.every((entry) => Number.isSafeInteger(entry.data.revision)));
  assert.ok(entries[0].data.revision < entries[1].data.revision);
  assert.ok(entries[1].data.revision < entries[2].data.revision);
  assert.ok(widgets.some((widget) => widget.lines?.some((line) => /Z-Image Turbo/.test(line))));
  assert.equal(widgets.at(-1).lines, undefined);
});

test("does not infer a run id from free-form prompt text and cleans up on execution end", () => {
  const handlers = new Map();
  const entries = [];
  const widgets = [];
  const pi = {
    registerTool() {},
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
  };
  comfyUiExtension(pi);
  const ctx = {
    cwd: "C:\\work",
    ui: { setWidget(key, lines) { widgets.push({ key, lines }); } },
  };
  const command = 'python zimage_client.py generate --prompt "wait for rain" --wait';

  handlers.get("tool_execution_start")({
    toolCallId: "tool-ghost",
    toolName: "bash",
    args: { command },
  }, ctx);
  assert.equal(entries.length, 0);

  handlers.get("tool_execution_end")({
    toolCallId: "tool-ghost",
    toolName: "bash",
    isError: false,
    result: { content: [{ type: "text", text: JSON.stringify({ id: "prompt-real", status: "completed", downloaded: ["C:\\renders\\real.png"] }) }] },
  }, ctx);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.runId, "prompt-real");
  assert.equal(entries[0].data.status, "succeeded");
  assert.equal(widgets.at(-1).lines, undefined);
});

test("terminal failures do not retain a running progress label", () => {
  const handlers = new Map();
  const entries = [];
  const pi = {
    registerTool() {},
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
  };
  comfyUiExtension(pi);
  const ctx = { cwd: "C:\\work", ui: { setWidget() {} } };
  const command = "python zimage_client.py generate --wait";

  handlers.get("tool_execution_start")({ toolCallId: "tool-fail", toolName: "bash", args: { command } }, ctx);
  handlers.get("tool_execution_update")({
    toolCallId: "tool-fail",
    toolName: "bash",
    args: { command },
    partialResult: { content: [{ type: "text", text: "Z-Image Turbo job prompt-fail: in_progress\n" }] },
  }, ctx);
  handlers.get("tool_result")({
    toolCallId: "tool-fail",
    toolName: "bash",
    input: { command },
    isError: true,
    content: [],
  }, ctx);

  const terminal = entries.at(-1).data;
  assert.equal(terminal.status, "failed");
  assert.equal(terminal.progress, undefined);
});

test("ordinary commands mentioning the package path do not create ComfyUI runs", () => {
  const handlers = new Map();
  const entries = [];
  const widgets = [];
  const pi = {
    registerTool() {},
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
  };
  comfyUiExtension(pi);
  const ctx = {
    cwd: "C:\\work",
    ui: { setWidget(key, lines) { widgets.push({ key, lines }); } },
  };
  const command = "rg nonexistent packages/pi-comfyui";

  handlers.get("tool_execution_start")({ toolCallId: "tool-rg", toolName: "bash", args: { command } }, ctx);
  handlers.get("tool_result")({
    toolCallId: "tool-rg",
    toolName: "bash",
    input: { command },
    isError: true,
    content: [{ type: "text", text: "no matches" }],
  }, ctx);

  assert.equal(entries.length, 0);
  assert.equal(widgets.length, 0);
});

test("a recognized client failure without an observed run id only clears its widget", () => {
  const handlers = new Map();
  const entries = [];
  const widgets = [];
  const pi = {
    registerTool() {},
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
  };
  comfyUiExtension(pi);
  const ctx = {
    cwd: "C:\\work",
    ui: { setWidget(key, lines) { widgets.push({ key, lines }); } },
  };
  const command = "python C:\\tools\\zimage_client.py generate --wait";

  handlers.get("tool_execution_start")({ toolCallId: "tool-no-id", toolName: "bash", args: { command } }, ctx);
  handlers.get("tool_execution_end")({
    toolCallId: "tool-no-id",
    toolName: "bash",
    isError: true,
    result: { content: [{ type: "text", text: "failed before submission" }] },
  }, ctx);

  assert.equal(entries.length, 0);
  assert.equal(widgets.at(-1).lines, undefined);
});

test("successful cancel commands terminate cards even when a client reports pending", () => {
  const handlers = new Map();
  const entries = [];
  const pi = {
    registerTool() {},
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
  };
  comfyUiExtension(pi);
  const ctx = { cwd: "C:\\work", ui: { setWidget() {} } };
  const command = "python C:\\tools\\zimage_client.py cancel prompt-cancelled";

  handlers.get("tool_execution_start")({ toolCallId: "tool-cancel", toolName: "bash", args: { command } }, ctx);
  handlers.get("tool_result")({
    toolCallId: "tool-cancel",
    toolName: "bash",
    input: { command },
    isError: false,
    content: [{ type: "text", text: JSON.stringify({ id: "prompt-cancelled", status: "pending", downloaded: [] }) }],
  }, ctx);

  assert.deepEqual(entries.map((entry) => entry.data.status), ["running", "cancelled"]);
  assert.equal(entries.at(-1).data.runId, "prompt-cancelled");
  assert.equal(entries.at(-1).data.progress, undefined);
});
