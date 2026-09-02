import path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const ARTIFACT_BUNDLE_CUSTOM_TYPE = "pi.artifact-bundle";
export const ARTIFACT_BUNDLE_SCHEMA = "pi.artifact-bundle/v1";
export const ARTIFACT_PROGRESS_ENTRY_CUSTOM_TYPE = "pi.artifact-progress";

const FINAL_STATUSES = ["succeeded", "failed", "cancelled"] as const;
const ARTIFACT_KINDS = ["image", "video", "audio", "model3d", "text", "file"] as const;
const MAX_PATH_LENGTH = 8_192;
const MAX_RUN_ID_LENGTH = 480;
const MAX_SHORT_TEXT_LENGTH = 512;
const MAX_SEED_LENGTH = 256;
const MAX_TITLE_LENGTH = 1_024;
const MAX_LONG_TEXT_LENGTH = 16_384;
const MAX_PUBLISHED_ARTIFACTS = 64;

export type PublishedArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type PublishedRunStatus = "queued" | "running" | (typeof FINAL_STATUSES)[number];

export interface PublishedArtifactProgress {
  value?: number;
  max?: number;
  percent?: number;
  queuePosition?: number;
  message?: string;
}

export interface PublishedArtifact {
  id: string;
  kind: PublishedArtifactKind;
  path: string;
  filename: string;
  label?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  nodeId?: string;
  batchIndex: number;
}

export interface PublishedArtifactBundle {
  schema: typeof ARTIFACT_BUNDLE_SCHEMA;
  provider: "comfyui";
  runId: string;
  revision?: number;
  status: PublishedRunStatus;
  title: string;
  summary?: string;
  workflow?: {
    name?: string;
    hash?: string;
    seed?: string;
  };
  createdAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  progress?: PublishedArtifactProgress;
  artifacts: PublishedArtifact[];
  error?: {
    message: string;
  };
}

interface PublishParams {
  runId?: string;
  status?: PublishedRunStatus;
  title?: string;
  summary?: string;
  workflowName?: string;
  workflowHash?: string;
  seed?: string;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  progress?: PublishedArtifactProgress;
  error?: string;
  artifacts: Array<{
    path: string;
    kind?: PublishedArtifactKind;
    label?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    duration?: number;
    fps?: number;
    nodeId?: string;
  }>;
}

const IMAGE_EXTENSIONS = new Set([".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav"]);
const MODEL_3D_EXTENSIONS = new Set([".fbx", ".glb", ".gltf", ".obj", ".ply", ".stl", ".usdz"]);
const TEXT_EXTENSIONS = new Set([".csv", ".json", ".md", ".prompt", ".txt", ".yaml", ".yml"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

type JsonReviverContext = { source?: string };
type SourceAwareJsonParse = (
  text: string,
  reviver: (key: string, value: unknown, context?: JsonReviverContext) => unknown,
) => unknown;

function parseClientJson(source: string): unknown {
  const parseWithSource = JSON.parse as unknown as SourceAwareJsonParse;
  return parseWithSource(source, (key, value, context) => {
    if (
      key === "seed"
      && typeof value === "number"
      && Number.isInteger(value)
      && !Number.isSafeInteger(value)
    ) {
      const token = context?.source;
      // Node 22 exposes the original primitive token to revivers. Preserve it
      // exactly; older runtimes omit the unsafe seed instead of publishing a
      // rounded value that cannot reproduce the generation.
      return token && /^-?(?:0|[1-9]\d*)$/u.test(token) ? token : undefined;
    }
    return value;
  });
}

function protocolText(
  value: unknown,
  maximum: number,
  singleLine = false,
): string | undefined {
  if (typeof value !== "string") return undefined;
  let text = value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .trim();
  if (singleLine) text = text.replace(/\s+/gu, " ");
  if (!text) return undefined;
  return text.slice(0, maximum);
}

function protocolInteger(value: number | undefined, maximum: number): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 1 && value <= maximum
    ? value
    : undefined;
}

function protocolNonNegativeInteger(value: number | undefined, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : undefined;
}

function protocolNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function protocolMimeType(value: string | undefined): string | undefined {
  const mimeType = optionalString(value);
  if (!mimeType || mimeType.length > 256) return undefined;
  return /^[\w!#$&^_.+-]+\/[\w!#$&^_.+*-]+(?:\s*;[^\r\n]*)?$/u.test(mimeType)
    ? mimeType
    : undefined;
}

function protocolTimestamp(value: string | undefined): string | undefined {
  const timestamp = optionalString(value);
  if (!timestamp || !/^\d{4}-\d{2}-\d{2}T/u.test(timestamp)) return undefined;
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

export function inferArtifactKind(filePath: string): PublishedArtifactKind {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (MODEL_3D_EXTENSIONS.has(extension)) return "model3d";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "file";
}

export function normalizeRunStatus(value: unknown): PublishedRunStatus | null {
  if (typeof value !== "string") return null;
  switch (value.trim().toLowerCase()) {
    case "pending":
    case "queued":
    case "queue":
      return "queued";
    case "in_progress":
    case "in-progress":
    case "processing":
    case "running":
      return "running";
    case "completed":
    case "complete":
    case "success":
    case "succeeded":
      return "succeeded";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
    case "interrupted":
      return "cancelled";
    default:
      return null;
  }
}

/** Extract complete top-level JSON objects/arrays from mixed log output. */
export function extractJsonDocuments(text: string): unknown[] {
  const documents: unknown[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start < 0) {
      if (character === "{" || character === "[") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") depth += 1;
    if (character === "}" || character === "]") depth -= 1;
    if (depth !== 0) continue;

    try {
      documents.push(parseClientJson(text.slice(start, index + 1)));
    } catch {
      // A brace in a log prefix can look like JSON. Ignore it and continue.
    }
    start = -1;
  }

  return documents;
}

function collectDownloadedPaths(
  value: unknown,
  result: string[] = [],
  seen = new Set<string>(),
  depth = 0,
): string[] {
  if (depth > 6 || !isRecord(value) || result.length >= MAX_PUBLISHED_ARTIFACTS) return result;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "downloaded" && Array.isArray(nested)) {
      for (const item of nested) {
        const candidate = optionalString(item);
        if (candidate && !seen.has(candidate)) {
          seen.add(candidate);
          result.push(candidate);
        }
        if (result.length >= MAX_PUBLISHED_ARTIFACTS) return result;
      }
      continue;
    }
    if (isRecord(nested)) collectDownloadedPaths(nested, result, seen, depth + 1);
    if (result.length >= MAX_PUBLISHED_ARTIFACTS) return result;
  }
  return result;
}

function findScalar(value: unknown, keys: ReadonlySet<string>, depth = 0): string | undefined {
  if (depth > 5 || !isRecord(value)) return undefined;
  for (const [key, nested] of Object.entries(value)) {
    if (keys.has(key)) {
      const candidate = scalarString(nested);
      if (candidate) return candidate;
    }
  }
  for (const nested of Object.values(value)) {
    if (!isRecord(nested)) continue;
    const candidate = findScalar(nested, keys, depth + 1);
    if (candidate) return candidate;
  }
  return undefined;
}

function findNumber(value: unknown, keys: ReadonlySet<string>, depth = 0): number | undefined {
  if (depth > 5 || !isRecord(value)) return undefined;
  for (const [key, nested] of Object.entries(value)) {
    if (keys.has(key) && typeof nested === "number" && Number.isFinite(nested)) return nested;
  }
  for (const nested of Object.values(value)) {
    if (!isRecord(nested)) continue;
    const candidate = findNumber(nested, keys, depth + 1);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function workflowNameFromCommand(command: string): string {
  const normalized = command.toLowerCase();
  if (normalized.includes("h3_client") || normalized.includes("minimax-h3")) return "MiniMax H3";
  if (normalized.includes("zimage_client") || normalized.includes("z-image")) return "Z-Image Turbo";
  if (normalized.includes("klein_client") || normalized.includes("flux2-klein")) return "FLUX.2 Klein";
  return "ComfyUI";
}

function progressMessage(status: PublishedRunStatus): string | undefined {
  if (status === "queued") return "Waiting in the ComfyUI queue";
  if (status === "running") return "Generating in ComfyUI";
  return undefined;
}

function structuredProgressFromText(text: string): {
  runId: string;
  status: "queued" | "running";
  progress?: PublishedArtifactProgress;
} | undefined {
  let latest: ReturnType<typeof structuredProgressFromText>;
  const lines = text.slice(-16_384).split(/\r?\n/u).slice(-64);
  for (const line of lines) {
    const match = line.match(/^PI_COMFYUI_PROGRESS\s+(.{2,4096})$/u);
    if (!match) continue;
    try {
      const document = JSON.parse(match[1]) as unknown;
      if (!isRecord(document)) continue;
      const runId = protocolText(document.runId, MAX_RUN_ID_LENGTH, true);
      const normalizedStatus = normalizeRunStatus(document.status);
      const status = normalizedStatus === "queued" || normalizedStatus === "running"
        ? normalizedStatus
        : null;
      if (!runId || !status) continue;
      latest = {
        runId,
        status,
        progress: publishedProgress({
          percent: document.percent as number | undefined,
          value: document.value as number | undefined,
          max: document.max as number | undefined,
          queuePosition: document.queuePosition as number | undefined,
          message: protocolText(document.message, 4_096, true),
        }),
      };
    } catch {
      // Only exact, valid NDJSON markers participate in numeric progress.
    }
  }
  return latest;
}

function progressFromDocument(
  document: Record<string, unknown>,
  status: PublishedRunStatus,
): PublishedArtifactProgress | undefined {
  let percent = findNumber(document, new Set(["percent", "percentage", "progress_percent"]));
  if (percent !== undefined && percent >= 0 && percent <= 1) percent *= 100;
  if (percent !== undefined && (percent < 0 || percent > 100)) percent = undefined;
  const value = findNumber(document, new Set(["value", "current", "progress_value"]));
  const max = findNumber(document, new Set(["max", "total", "progress_max"]));
  const queuePosition = findNumber(document, new Set(["queue_position", "queuePosition"]));
  return publishedProgress({
    percent,
    value,
    max,
    queuePosition,
    message: progressMessage(status),
  });
}

export function bundleFromClientProgress(
  text: string,
  command: string,
  cwd: string,
  fallbackRunId?: string,
): PublishedArtifactBundle | null {
  const tail = text.slice(-16_384);
  const structuredProgress = structuredProgressFromText(tail);
  const statusPattern = /^(MiniMax H3|Z-Image Turbo|FLUX\.2 Klein) job ([^:\r\n]+):\s*([A-Za-z_-]+)\s*$/gimu;
  let matchedRunId: string | undefined;
  let matchedStatus: PublishedRunStatus | null = null;
  for (const match of tail.matchAll(statusPattern)) {
    const status = normalizeRunStatus(match[3]);
    if (!status) continue;
    matchedRunId = protocolText(match[2], MAX_RUN_ID_LENGTH, true);
    matchedStatus = status;
  }
  const textProgress = structuredProgress?.progress;
  const runId = structuredProgress?.runId
    ?? matchedRunId
    ?? protocolText(fallbackRunId, MAX_RUN_ID_LENGTH, true);
  const status = structuredProgress?.status ?? matchedStatus;
  if (!runId || !status || (status !== "queued" && status !== "running")) return null;

  const workflowName = workflowNameFromCommand(command);
  return buildPublishedBundle({
    runId,
    status,
    title: `${workflowName} generation`,
    workflowName,
    progress: {
      ...textProgress,
      message: textProgress?.message ?? progressMessage(status),
    },
    artifacts: [],
  }, cwd);
}

const WINDOWS_RESERVED_DEVICE_BASENAME = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM(?:[1-9]|[\u00b9\u00b2\u00b3])|LPT(?:[1-9]|[\u00b9\u00b2\u00b3]))$/iu;

function isWindowsDevicePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  if (/^\/\/[?.](?:\/|$)/u.test(normalized)) return true;
  const pathWithoutRoot = /^[A-Za-z]:\//u.test(normalized)
    ? normalized.slice(3)
    : normalized.startsWith("/") && !normalized.startsWith("//")
      ? normalized.slice(1)
      : null;
  if (pathWithoutRoot === null) return false;
  return pathWithoutRoot.split("/").some((segment) => {
    if (!segment || /[<>:"|?*\u0000-\u001f]/u.test(segment) || /[ .]$/u.test(segment)) {
      return true;
    }
    const withoutAds = segment.split(":", 1)[0];
    const firstDot = withoutAds.indexOf(".");
    const basename = (firstDot < 0 ? withoutAds : withoutAds.slice(0, firstDot))
      .replace(/[ .]+$/u, "");
    return WINDOWS_RESERVED_DEVICE_BASENAME.test(basename);
  });
}

function normalizedLocalPath(value: string, cwd: string): string | null {
  if (
    !value
    || value.length > MAX_PATH_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)
    || /[ .]$/u.test(value)
  ) {
    return null;
  }
  const candidate = value.trim();
  if (!candidate) return null;
  if (candidate.replace(/\\/g, "/").startsWith("//") || isWindowsDevicePath(candidate)) return null;
  // On Windows, `/foo` and `\foo` are rooted on the current drive. Resolve
  // them first so DOS device basenames cannot hide behind a missing drive.
  const resolved = path.resolve(cwd, candidate);
  return resolved.length <= MAX_PATH_LENGTH
    && !/[\u0000-\u001f\u007f]/u.test(resolved)
    && !resolved.replace(/\\/g, "/").startsWith("//")
    && !isWindowsDevicePath(resolved)
    ? resolved
    : null;
}

function artifactId(runId: string, index: number): string {
  return `${runId}:output:${index}`;
}

function createArtifact(
  item: PublishParams["artifacts"][number],
  runId: string,
  cwd: string,
  index: number,
): PublishedArtifact | null {
  const filePath = normalizedLocalPath(item.path, cwd);
  if (!filePath) return null;
  return {
    id: artifactId(runId, index),
    kind: item.kind ?? inferArtifactKind(filePath),
    path: filePath,
    filename: protocolText(path.basename(filePath), MAX_SHORT_TEXT_LENGTH, true) ?? `output-${index + 1}`,
    label: protocolText(item.label, MAX_SHORT_TEXT_LENGTH, true),
    mimeType: protocolMimeType(item.mimeType),
    width: protocolInteger(item.width, 1_000_000),
    height: protocolInteger(item.height, 1_000_000),
    duration: protocolNumber(item.duration, 0, Number.MAX_VALUE),
    fps: protocolNumber(item.fps, 0.000_001, 10_000),
    nodeId: protocolText(item.nodeId, MAX_SHORT_TEXT_LENGTH, true),
    batchIndex: index,
  };
}

function publishedProgress(value: PublishedArtifactProgress | undefined): PublishedArtifactProgress | undefined {
  if (!value) return undefined;
  const current = protocolNumber(value.value, 0, Number.MAX_VALUE);
  const max = protocolNumber(value.max, 0.000_001, Number.MAX_VALUE);
  const progress: PublishedArtifactProgress = {
    percent: protocolNumber(value.percent, 0, 100),
    queuePosition: protocolNonNegativeInteger(value.queuePosition),
    message: protocolText(value.message, 4_096, true),
  };
  if (current !== undefined && max !== undefined && current <= max) {
    progress.value = current;
    progress.max = max;
  }
  return Object.values(progress).some((item) => item !== undefined) ? progress : undefined;
}

export function buildPublishedBundle(params: PublishParams, cwd: string): PublishedArtifactBundle {
  const runId = protocolText(params.runId, MAX_RUN_ID_LENGTH, true) ?? `comfyui-${Date.now()}`;
  const artifacts = params.artifacts
    .map((item, index) => createArtifact(item, runId, cwd, index))
    .filter((artifact): artifact is PublishedArtifact => artifact !== null);
  const workflowName = protocolText(params.workflowName, MAX_SHORT_TEXT_LENGTH, true);
  const workflowHash = protocolText(params.workflowHash, MAX_SHORT_TEXT_LENGTH, true);
  const workflowSeed = protocolText(params.seed, MAX_SEED_LENGTH, true);
  const workflow = workflowName || workflowHash || workflowSeed
    ? { name: workflowName, hash: workflowHash, seed: workflowSeed }
    : undefined;
  return {
    schema: ARTIFACT_BUNDLE_SCHEMA,
    provider: "comfyui",
    runId,
    status: params.status ?? "succeeded",
    title: protocolText(params.title, MAX_TITLE_LENGTH, true)
      ?? protocolText(params.workflowName, MAX_TITLE_LENGTH, true)
      ?? "ComfyUI result",
    summary: protocolText(params.summary, MAX_LONG_TEXT_LENGTH),
    workflow,
    createdAt: protocolTimestamp(params.startedAt),
    completedAt: protocolTimestamp(params.completedAt),
    elapsedMs: protocolNumber(params.elapsedMs, 0, Number.MAX_SAFE_INTEGER),
    progress: publishedProgress(params.progress),
    artifacts,
    error: protocolText(params.error, MAX_LONG_TEXT_LENGTH)
      ? { message: protocolText(params.error, MAX_LONG_TEXT_LENGTH)! }
      : undefined,
  };
}

export function bundleFromClientOutput(
  text: string,
  command: string,
  cwd: string,
  toolFailed = false,
): PublishedArtifactBundle | null {
  const documents = extractJsonDocuments(text);
  for (let index = documents.length - 1; index >= 0; index -= 1) {
    const document = documents[index];
    if (!isRecord(document)) continue;
    const downloaded = collectDownloadedPaths(document);
    const reportedStatus = normalizeRunStatus(document.status);
    if (!reportedStatus && !toolFailed) continue;

    const status = toolFailed ? "failed" : reportedStatus;
    if (!status) continue;
    if (downloaded.length === 0 && status === "succeeded") continue;
    const workflowName = workflowNameFromCommand(command);
    const runId = findScalar(document, new Set(["id", "prompt_id", "promptId", "generation_id"]))
      ?? `comfyui-${Date.now()}`;
    const seed = findScalar(document, new Set(["seed"]));
    const error = status === "failed"
      ? findScalar(document, new Set(["error", "message", "exception_message"]))
        ?? (toolFailed ? "ComfyUI command failed" : "ComfyUI generation failed")
      : undefined;

    const bundle = buildPublishedBundle({
      runId,
      status,
      title: `${workflowName} result`,
      workflowName,
      seed,
      error,
      progress: progressFromDocument(document, status),
      artifacts: downloaded.map((filePath) => ({ path: filePath })),
    }, cwd);
    if (bundle.status === "succeeded" && bundle.artifacts.length === 0) continue;
    bundle.summary = bundle.artifacts.length > 0
      ? `${bundle.artifacts.length} output${bundle.artifacts.length === 1 ? "" : "s"}`
      : status === "queued"
        ? "Waiting for ComfyUI"
        : status === "running"
          ? "Generation in progress"
          : "No outputs";
    return bundle;
  }
  return null;
}

export function bundleContent(bundle: PublishedArtifactBundle): string {
  const title = protocolText(bundle.title, 512, true) ?? "ComfyUI result";
  const summary = protocolText(
    bundle.summary ?? bundle.error?.message,
    1_000,
    true,
  ) ?? `${bundle.artifacts.length} output${bundle.artifacts.length === 1 ? "" : "s"}`;
  const paths = bundle.artifacts
    .slice(0, 8)
    .map((artifact) => protocolText(artifact.path, 512, true))
    .filter((filePath): filePath is string => Boolean(filePath));
  if (bundle.artifacts.length > paths.length) paths.push(`… ${bundle.artifacts.length - paths.length} more`);
  return [`${title}: ${bundle.status} · ${summary}`, ...paths].join("\n");
}

function bundleSignature(bundle: PublishedArtifactBundle): string {
  return JSON.stringify({
    status: bundle.status,
    title: bundle.title,
    summary: bundle.summary,
    workflow: bundle.workflow,
    progress: bundle.progress,
    artifacts: bundle.artifacts,
    error: bundle.error,
  });
}

function bundleIdentity(bundle: PublishedArtifactBundle): string {
  return `${bundle.provider}\u0000${bundle.runId}`;
}

function isTerminalStatus(status: PublishedRunStatus): status is (typeof FINAL_STATUSES)[number] {
  return FINAL_STATUSES.includes(status as (typeof FINAL_STATUSES)[number]);
}

type RecognizedComfySubcommand = "generate" | "status" | "wait" | "cancel";

function parseRecognizedComfyCommand(command: string): {
  subcommand: RecognizedComfySubcommand;
  runId?: string;
} | null {
  const client = String.raw`(?:"[^"\r\n]*(?:h3_client|zimage_client|klein_client)\.py"|'[^'\r\n]*(?:h3_client|zimage_client|klein_client)\.py'|[^\s;&|]*(?:h3_client|zimage_client|klein_client)\.py|\$(?:h3|zimage|klein)ClientPath)`;
  const python = String.raw`(?:(?:uv\s+run\s+)?(?:python(?:3(?:\.\d+)?)?|py)(?:\.exe)?)`;
  const match = new RegExp(
    String.raw`(?:^|[;\r\n])\s*(?:&\s*)?${python}\s+${client}\s+(generate|status|wait|cancel)(?=\s|$)`,
    "iu",
  ).exec(command);
  if (!match) return null;
  const subcommand = match[1].toLowerCase() as RecognizedComfySubcommand;
  if (subcommand === "generate") return { subcommand };

  const remainder = command.slice(match.index + match[0].length);
  const argument = remainder.match(/^\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s;|&]+))/u);
  const runId = argument?.[1] ?? argument?.[2] ?? argument?.[3];
  return {
    subcommand,
    runId: runId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(runId) ? runId : undefined,
  };
}

function isRecognizedComfyCommand(command: string): boolean {
  return parseRecognizedComfyCommand(command) !== null;
}

function toolOutputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value) || !Array.isArray(value.content)) return "";
  return value.content
    .filter((item): item is { type: "text"; text: string } => (
      isRecord(item) && item.type === "text" && typeof item.text === "string"
    ))
    .map((item) => item.text)
    .join("\n");
}

function elapsedLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function textProgressBar(percent: number | undefined, frame: number): string {
  if (percent === undefined) return ["|", "/", "-", "\\"][frame % 4];
  const filled = Math.min(10, Math.max(0, Math.round(percent / 10)));
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${Math.round(percent)}%`;
}

export default function comfyUiExtension(pi: ExtensionAPI) {
  const published = new Map<string, string>();
  const revisions = new Map<string, number>();
  type ActiveRun = {
    toolCallId: string;
    command: string;
    cwd: string;
    workflowName: string;
    subcommand: RecognizedComfySubcommand;
    startedAt: number;
    runId?: string;
    status: PublishedRunStatus;
    progress?: PublishedArtifactProgress;
    timer?: ReturnType<typeof setInterval>;
    renderWidget: () => void;
    clearWidget: () => void;
  };
  const activeRuns = new Map<string, ActiveRun>();

  const latestActiveRun = (): ActiveRun | undefined => Array.from(activeRuns.values()).at(-1);

  const withRevision = (bundle: PublishedArtifactBundle): PublishedArtifactBundle | null => {
    const identity = bundleIdentity(bundle);
    const signature = bundleSignature(bundle);
    if (published.get(identity) === signature) return null;
    published.set(identity, signature);
    // Wall-clock revisions stay monotonic across extension/server reloads for
    // the same run, while the +1 path handles multiple snapshots in one ms.
    const revision = Math.max(Date.now(), (revisions.get(identity) ?? 0) + 1);
    revisions.set(identity, revision);
    return { ...bundle, revision };
  };

  const publishProgress = (bundle: PublishedArtifactBundle): boolean => {
    if (isTerminalStatus(bundle.status)) return false;
    const revised = withRevision(bundle);
    if (!revised) return false;
    pi.appendEntry(ARTIFACT_PROGRESS_ENTRY_CUSTOM_TYPE, revised);
    return true;
  };

  const publishFinal = (bundle: PublishedArtifactBundle): boolean => {
    if (!isTerminalStatus(bundle.status)) return false;
    const revised = withRevision(bundle);
    if (!revised) return false;
    // Keep presentation snapshots outside the LLM message stream. Injecting a
    // custom message from tool_result can split an assistant tool call from its
    // matching toolResult and invalidate provider history ordering.
    pi.appendEntry(ARTIFACT_PROGRESS_ENTRY_CUSTOM_TYPE, revised);
    return true;
  };

  const decorateBundle = (
    bundle: PublishedArtifactBundle,
    state: ActiveRun | undefined,
  ): PublishedArtifactBundle => {
    if (!state) return bundle;
    const now = Date.now();
    const terminal = isTerminalStatus(bundle.status);
    const progress = bundle.status === "succeeded"
      ? { percent: 100, message: "Completed" }
      : terminal
        ? bundle.progress
        : bundle.progress ?? state.progress;
    return {
      ...bundle,
      createdAt: bundle.createdAt ?? new Date(state.startedAt).toISOString(),
      completedAt: terminal ? bundle.completedAt ?? new Date(now).toISOString() : bundle.completedAt,
      elapsedMs: Math.max(0, now - state.startedAt),
      progress,
    };
  };

  const createActiveRun = (
    toolCallId: string,
    command: string,
    cwd: string,
    ctx: { ui: { setWidget: (key: string, lines: string[] | undefined) => void } },
  ): ActiveRun => {
    const invocation = parseRecognizedComfyCommand(command);
    if (!invocation) throw new Error("Unrecognized ComfyUI client command");
    const state: ActiveRun = {
      toolCallId,
      command,
      cwd,
      workflowName: workflowNameFromCommand(command),
      subcommand: invocation.subcommand,
      startedAt: Date.now(),
      runId: invocation.runId,
      status: "running" as PublishedRunStatus,
      progress: { message: "Starting ComfyUI" },
      renderWidget: () => {},
      clearWidget: () => {},
    };
    state.renderWidget = () => {
      if (latestActiveRun() !== state) return;
      const elapsed = Date.now() - state.startedAt;
      const percent = state.progress?.percent
        ?? (state.progress?.value !== undefined && state.progress.max
          ? state.progress.value / state.progress.max * 100
          : undefined);
      const stage = state.progress?.message
        ?? (state.status === "queued" ? "Queued" : "Running");
      const lines = [
        `${state.workflowName} - ${stage}`,
        `${textProgressBar(percent, Math.floor(elapsed / 1_000))} - ${elapsedLabel(elapsed)}`,
      ];
      if (state.runId) lines.push(`Run ${state.runId}`);
      try {
        ctx.ui.setWidget("ComfyUI", lines);
      } catch {
        // Headless pi modes may not expose a live widget surface.
      }
    };
    state.clearWidget = () => {
      try {
        ctx.ui.setWidget("ComfyUI", undefined);
      } catch {
        // Ignore teardown after the extension UI has already gone away.
      }
    };
    activeRuns.set(toolCallId, state);
    state.renderWidget();
    state.timer = setInterval(state.renderWidget, 1_000);
    return state;
  };

  const finishActiveRun = (toolCallId: string): ActiveRun | undefined => {
    const state = activeRuns.get(toolCallId);
    if (!state) return undefined;
    if (state.timer) clearInterval(state.timer);
    activeRuns.delete(toolCallId);
    const next = latestActiveRun();
    if (next) next.renderWidget();
    else state.clearWidget();
    return state;
  };

  const normalizeSuccessfulCancel = (
    bundle: PublishedArtifactBundle | null,
    state: ActiveRun | undefined,
    isError: boolean,
  ): PublishedArtifactBundle | null => {
    if (isError || state?.subcommand !== "cancel") return bundle;
    const runId = bundle?.runId ?? state.runId;
    if (!runId) return bundle;
    if (bundle) {
      return {
        ...bundle,
        status: "cancelled",
        summary: "Cancelled",
        progress: undefined,
        error: undefined,
      };
    }
    return buildPublishedBundle({
      runId,
      status: "cancelled",
      title: `${state.workflowName} result`,
      summary: "Cancelled",
      workflowName: state.workflowName,
      artifacts: [],
    }, state.cwd);
  };

  pi.registerTool({
    name: "comfyui_publish",
    label: "Publish ComfyUI result",
    description: "Publish final local ComfyUI outputs as one structured Pi Web artifact card. Call once after a generation reaches succeeded, failed, or cancelled.",
    promptSnippet: "Publish final ComfyUI output files as a rich artifact card",
    promptGuidelines: [
      "After a ComfyUI workflow returns local output paths, call comfyui_publish once unless the package already published the result automatically.",
      "Prefer absolute local paths and never pass full-resolution base64 data.",
    ],
    parameters: Type.Object({
      runId: Type.Optional(Type.String({ description: "ComfyUI prompt or generation id" })),
      status: Type.Optional(StringEnum(FINAL_STATUSES, { description: "Final run status" })),
      title: Type.Optional(Type.String({ description: "Short card title" })),
      summary: Type.Optional(Type.String({ description: "Concise result summary" })),
      workflowName: Type.Optional(Type.String({ description: "Workflow or model name" })),
      workflowHash: Type.Optional(Type.String({ description: "Optional workflow digest" })),
      seed: Type.Optional(Type.String({ description: "Exact seed as a string" })),
      startedAt: Type.Optional(Type.String({ description: "ISO start timestamp" })),
      completedAt: Type.Optional(Type.String({ description: "ISO completion timestamp" })),
      error: Type.Optional(Type.String({ description: "Terminal error message" })),
      artifacts: Type.Array(Type.Object({
        path: Type.String({ description: "Absolute or session-relative local output path" }),
        kind: Type.Optional(StringEnum(ARTIFACT_KINDS)),
        label: Type.Optional(Type.String()),
        mimeType: Type.Optional(Type.String()),
        width: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
        height: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
        duration: Type.Optional(Type.Number({ minimum: 0 })),
        fps: Type.Optional(Type.Number({ minimum: 0.000_001, maximum: 10_000 })),
        nodeId: Type.Optional(Type.String()),
      }), { maxItems: 64 }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const bundle = buildPublishedBundle(params, ctx.cwd);
      if (bundle.status === "succeeded" && bundle.artifacts.length === 0) {
        // The agent loop marks a tool call as failed only when execute throws;
        // an `isError` property on AgentToolResult itself is intentionally ignored.
        throw new Error("No valid local ComfyUI artifact paths were provided.");
      }
      const didPublish = publishFinal(bundle);
      return {
        content: [{
          type: "text",
          text: didPublish
            ? `Published ${bundle.artifacts.length} ComfyUI artifact${bundle.artifacts.length === 1 ? "" : "s"}.`
            : `ComfyUI artifact bundle ${bundle.runId} was already published.`,
        }],
        details: { runId: bundle.runId, published: didPublish },
      };
    },
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command = optionalString(event.args?.command) ?? "";
    if (!isRecognizedComfyCommand(command)) return;
    const state = createActiveRun(event.toolCallId, command, ctx.cwd, ctx);
    if (state.runId) {
      publishProgress(decorateBundle(buildPublishedBundle({
        runId: state.runId,
        status: state.status,
        title: `${state.workflowName} generation`,
        workflowName: state.workflowName,
        progress: state.progress,
        artifacts: [],
      }, state.cwd), state));
    }
  });

  pi.on("tool_execution_update", (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command = optionalString(event.args?.command) ?? "";
    let state = activeRuns.get(event.toolCallId);
    if (!state) {
      if (!isRecognizedComfyCommand(command)) return;
      state = createActiveRun(event.toolCallId, command, ctx.cwd, ctx);
    }
    const text = toolOutputText(event.partialResult);
    if (!text) return;
    const bundle = bundleFromClientOutput(text, state.command, state.cwd)
      ?? bundleFromClientProgress(text, state.command, state.cwd, state.runId);
    if (!bundle) return;
    state.runId = bundle.runId;
    state.status = bundle.status;
    state.progress = bundle.progress ?? state.progress;
    state.renderWidget();
    if (!isTerminalStatus(bundle.status)) publishProgress(decorateBundle(bundle, state));
  });

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "bash") return;
    const state = activeRuns.get(event.toolCallId);
    const command = state?.command ?? optionalString(event.input.command) ?? "";
    if (!state && !isRecognizedComfyCommand(command)) return;
    try {
      const text = toolOutputText({ content: event.content });
      let bundle = bundleFromClientOutput(text, command, ctx.cwd, event.isError)
        ?? bundleFromClientProgress(text, command, ctx.cwd, state?.runId);
      bundle = normalizeSuccessfulCancel(bundle, state, event.isError);
      if (!bundle && event.isError && state?.runId) {
        bundle = buildPublishedBundle({
          runId: state.runId,
          status: "failed",
          title: `${workflowNameFromCommand(command)} result`,
          workflowName: workflowNameFromCommand(command),
          error: "ComfyUI command failed",
          artifacts: [],
        }, ctx.cwd);
      }
      if (!bundle) return;
      const decorated = decorateBundle(bundle, state);
      if (isTerminalStatus(decorated.status)) publishFinal(decorated);
      else publishProgress(decorated);
    } finally {
      finishActiveRun(event.toolCallId);
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (event.toolName !== "bash") return;
    const state = activeRuns.get(event.toolCallId);
    if (!state) return;
    try {
      const text = toolOutputText(event.result);
      let bundle = bundleFromClientOutput(text, state.command, state.cwd, event.isError)
        ?? bundleFromClientProgress(text, state.command, state.cwd, state.runId);
      bundle = normalizeSuccessfulCancel(bundle, state, event.isError);
      if (!bundle && event.isError && state.runId) {
        bundle = buildPublishedBundle({
          runId: state.runId,
          status: "failed",
          title: `${state.workflowName} result`,
          workflowName: state.workflowName,
          error: "ComfyUI command failed",
          artifacts: [],
        }, ctx.cwd);
      }
      if (!bundle) return;
      const decorated = decorateBundle(bundle, state);
      if (isTerminalStatus(decorated.status)) publishFinal(decorated);
      else publishProgress(decorated);
    } finally {
      finishActiveRun(event.toolCallId);
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    for (const state of activeRuns.values()) {
      if (state.timer) clearInterval(state.timer);
    }
    activeRuns.clear();
    try {
      ctx.ui.setWidget("ComfyUI", undefined);
    } catch {
      // UI teardown is best-effort.
    }
  });
}
