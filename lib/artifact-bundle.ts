import {
  isNetworkOrDeviceFileApiUrl,
  isWindowsDeviceFilePath,
} from "./file-paths";
import type { AgentMessage, CustomMessage, SessionEntry } from "./types";

export const ARTIFACT_BUNDLE_SCHEMA = "pi.artifact-bundle/v1" as const;
export const ARTIFACT_BUNDLE_CUSTOM_TYPE = "pi.artifact-bundle" as const;
export const ARTIFACT_PROGRESS_ENTRY_CUSTOM_TYPE = "pi.artifact-progress" as const;

export const ARTIFACT_KINDS = [
  "image",
  "video",
  "audio",
  "text",
  "file",
  "model3d",
] as const;

export const ARTIFACT_BUNDLE_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type ArtifactBundleStatus = (typeof ARTIFACT_BUNDLE_STATUSES)[number];
export type ArtifactMetadataValue = string | number | boolean | null;
export type ArtifactMetadata = Record<string, ArtifactMetadataValue>;

export interface ArtifactWorkflowV1 {
  name?: string;
  hash?: string;
  path?: string;
  url?: string;
  model?: string;
  checkpoint?: string;
  seed?: string | number;
  sampler?: string;
  scheduler?: string;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  metadata?: ArtifactMetadata;
}

export interface ArtifactProgressV1 {
  value?: number;
  max?: number;
  percent?: number;
  nodeId?: string;
  nodeTitle?: string;
  queuePosition?: number;
  message?: string;
}

export interface ArtifactV1 {
  id?: string;
  kind: ArtifactKind;
  path?: string;
  url?: string;
  filename?: string;
  label?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  posterPath?: string;
  posterUrl?: string;
  text?: string;
  nodeId?: string;
  batchIndex?: number;
  metadata?: ArtifactMetadata;
}

export interface ArtifactErrorV1 {
  message: string;
  code?: string;
  nodeId?: string;
  details?: string;
}

export interface ArtifactBundleV1 {
  schema: typeof ARTIFACT_BUNDLE_SCHEMA;
  provider: string;
  runId: string;
  revision?: number;
  status: ArtifactBundleStatus;
  title?: string;
  summary?: string;
  createdAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  workflow?: ArtifactWorkflowV1;
  progress?: ArtifactProgressV1;
  artifacts: ArtifactV1[];
  error?: ArtifactErrorV1;
  errors?: ArtifactErrorV1[];
}

const MAX_ARTIFACTS = 256;
const MAX_ERRORS = 64;
const MAX_METADATA_ENTRIES = 64;
const MAX_SHORT_TEXT_LENGTH = 512;
const MAX_LONG_TEXT_LENGTH = 100_000;
const MAX_PATH_OR_URL_LENGTH = 8_192;
const MAX_DIMENSION = 1_000_000;
const MAX_FPS = 10_000;

const BUNDLE_KEYS = new Set([
  "schema",
  "provider",
  "runId",
  "revision",
  "status",
  "title",
  "summary",
  "createdAt",
  "completedAt",
  "elapsedMs",
  "workflow",
  "progress",
  "artifacts",
  "error",
  "errors",
]);

const WORKFLOW_KEYS = new Set([
  "name",
  "hash",
  "path",
  "url",
  "model",
  "checkpoint",
  "seed",
  "sampler",
  "scheduler",
  "steps",
  "cfg",
  "width",
  "height",
  "duration",
  "fps",
  "metadata",
]);

const PROGRESS_KEYS = new Set([
  "value",
  "max",
  "percent",
  "nodeId",
  "nodeTitle",
  "queuePosition",
  "message",
]);

const ARTIFACT_KEYS = new Set([
  "id",
  "kind",
  "path",
  "url",
  "filename",
  "label",
  "mimeType",
  "width",
  "height",
  "duration",
  "fps",
  "posterPath",
  "posterUrl",
  "text",
  "nodeId",
  "batchIndex",
  "metadata",
]);

const ERROR_KEYS = new Set(["message", "code", "nodeId", "details"]);
const UNSAFE_METADATA_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function normalizeString(
  value: unknown,
  maxLength = MAX_SHORT_TEXT_LENGTH,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000]/u.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function normalizeOptionalString(
  value: unknown,
  maxLength = MAX_SHORT_TEXT_LENGTH,
): string | null | undefined {
  if (value === undefined) return undefined;
  return normalizeString(value, maxLength) ?? null;
}

function normalizeFiniteNumber(value: unknown, minimum = 0, maximum = Number.MAX_VALUE): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    return undefined;
  }
  return value;
}

function normalizeOptionalNumber(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_VALUE,
): number | null | undefined {
  if (value === undefined) return undefined;
  return normalizeFiniteNumber(value, minimum, maximum) ?? null;
}

function normalizeOptionalInteger(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number | null | undefined {
  const normalized = normalizeOptionalNumber(value, minimum, maximum);
  if (normalized === undefined || normalized === null) return normalized;
  return Number.isSafeInteger(normalized) ? normalized : null;
}

export function normalizeArtifactLocalPath(value: unknown): string | null {
  if (
    typeof value !== "string"
    || !value
    || value.length > MAX_PATH_OR_URL_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)
    || /[ .]$/u.test(value)
  ) {
    return null;
  }
  const path = value.trim();
  if (!path) return null;

  const normalized = path.replace(/\\/g, "/");
  const isPosixAbsolute = normalized.startsWith("/") && !normalized.startsWith("//");
  const isWindowsAbsolute = /^[A-Za-z]:\//u.test(normalized);
  return (isPosixAbsolute || isWindowsAbsolute) && !isWindowsDeviceFilePath(normalized, true)
    ? normalized
    : null;
}

export function normalizeArtifactUrl(value: unknown): string | null {
  const url = normalizeString(value, MAX_PATH_OR_URL_LENGTH);
  if (!url || /[\u0000-\u001f\u007f]/u.test(url)) return null;

  if (url.startsWith("/")) {
    try {
      const parsed = new URL(url, "http://pi-web.local");
      if (parsed.origin !== "http://pi-web.local" || !parsed.pathname.startsWith("/api/files/")) {
        return null;
      }
      if (isNetworkOrDeviceFileApiUrl(url, true)) return null;
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }

  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeOptionalPath(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return normalizeArtifactLocalPath(value);
}

function normalizeOptionalUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return normalizeArtifactUrl(value);
}

function normalizeMetadata(value: unknown): ArtifactMetadata | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_ENTRIES) return null;

  const metadata: ArtifactMetadata = {};
  for (const [rawKey, rawValue] of entries) {
    const key = normalizeString(rawKey, 128);
    if (!key || key !== rawKey || UNSAFE_METADATA_KEYS.has(key)) return null;
    if (
      rawValue !== null
      && typeof rawValue !== "string"
      && typeof rawValue !== "number"
      && typeof rawValue !== "boolean"
    ) {
      return null;
    }
    if (typeof rawValue === "string" && rawValue.length > MAX_LONG_TEXT_LENGTH) return null;
    if (typeof rawValue === "number" && !Number.isFinite(rawValue)) return null;
    metadata[key] = rawValue;
  }
  return metadata;
}

function assignOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function normalizeWorkflow(value: unknown): ArtifactWorkflowV1 | null {
  if (!isRecord(value) || !hasOnlyKeys(value, WORKFLOW_KEYS) || Object.keys(value).length === 0) {
    return null;
  }

  const path = normalizeOptionalPath(value.path);
  const url = normalizeOptionalUrl(value.url);
  const name = normalizeOptionalString(value.name);
  const hash = normalizeOptionalString(value.hash);
  const model = normalizeOptionalString(value.model);
  const checkpoint = normalizeOptionalString(value.checkpoint);
  const sampler = normalizeOptionalString(value.sampler);
  const scheduler = normalizeOptionalString(value.scheduler);
  const steps = normalizeOptionalInteger(value.steps, 1, 1_000_000);
  const cfg = normalizeOptionalNumber(value.cfg, 0, 1_000_000);
  const width = normalizeOptionalInteger(value.width, 1, MAX_DIMENSION);
  const height = normalizeOptionalInteger(value.height, 1, MAX_DIMENSION);
  const duration = normalizeOptionalNumber(value.duration, 0, Number.MAX_VALUE);
  const fps = normalizeOptionalNumber(value.fps, 0.000_001, MAX_FPS);
  if (
    path === null
    || url === null
    || name === null
    || hash === null
    || model === null
    || checkpoint === null
    || sampler === null
    || scheduler === null
    || steps === null
    || cfg === null
    || width === null
    || height === null
    || duration === null
    || fps === null
  ) {
    return null;
  }

  let seed: string | number | undefined;
  if (value.seed !== undefined) {
    if (typeof value.seed === "string") {
      seed = normalizeString(value.seed, 256);
      if (!seed) return null;
    } else if (typeof value.seed === "number" && Number.isSafeInteger(value.seed)) {
      seed = value.seed;
    } else {
      return null;
    }
  }

  let metadata: ArtifactMetadata | undefined;
  if (value.metadata !== undefined) {
    metadata = normalizeMetadata(value.metadata) ?? undefined;
    if (!metadata) return null;
  }

  const workflow: ArtifactWorkflowV1 = {};
  assignOptional(workflow, "name", name);
  assignOptional(workflow, "hash", hash);
  assignOptional(workflow, "path", path);
  assignOptional(workflow, "url", url);
  assignOptional(workflow, "model", model);
  assignOptional(workflow, "checkpoint", checkpoint);
  assignOptional(workflow, "seed", seed);
  assignOptional(workflow, "sampler", sampler);
  assignOptional(workflow, "scheduler", scheduler);
  assignOptional(workflow, "steps", steps);
  assignOptional(workflow, "cfg", cfg);
  assignOptional(workflow, "width", width);
  assignOptional(workflow, "height", height);
  assignOptional(workflow, "duration", duration);
  assignOptional(workflow, "fps", fps);
  assignOptional(workflow, "metadata", metadata);
  return Object.keys(workflow).length > 0 ? workflow : null;
}

function normalizeProgress(value: unknown): ArtifactProgressV1 | null {
  if (!isRecord(value) || !hasOnlyKeys(value, PROGRESS_KEYS) || Object.keys(value).length === 0) {
    return null;
  }

  const current = normalizeOptionalNumber(value.value, 0, Number.MAX_VALUE);
  const max = normalizeOptionalNumber(value.max, 0.000_001, Number.MAX_VALUE);
  let percent = normalizeOptionalNumber(value.percent, 0, 100);
  const nodeId = normalizeOptionalString(value.nodeId);
  const nodeTitle = normalizeOptionalString(value.nodeTitle);
  const queuePosition = normalizeOptionalInteger(value.queuePosition, 0);
  const message = normalizeOptionalString(value.message, 4_096);
  if (
    current === null
    || max === null
    || percent === null
    || nodeId === null
    || nodeTitle === null
    || queuePosition === null
    || message === null
  ) {
    return null;
  }
  if ((current === undefined) !== (max === undefined)) return null;
  if (current !== undefined && max !== undefined && current > max) return null;
  if (percent === undefined && current !== undefined && max !== undefined) {
    percent = (current / max) * 100;
  }

  const progress: ArtifactProgressV1 = {};
  assignOptional(progress, "value", current);
  assignOptional(progress, "max", max);
  assignOptional(progress, "percent", percent);
  assignOptional(progress, "nodeId", nodeId);
  assignOptional(progress, "nodeTitle", nodeTitle);
  assignOptional(progress, "queuePosition", queuePosition);
  assignOptional(progress, "message", message);
  return Object.keys(progress).length > 0 ? progress : null;
}

function normalizeArtifact(value: unknown): ArtifactV1 | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ARTIFACT_KEYS)) return null;
  if (!ARTIFACT_KINDS.includes(value.kind as ArtifactKind)) return null;

  const path = normalizeOptionalPath(value.path);
  const url = normalizeOptionalUrl(value.url);
  const posterPath = normalizeOptionalPath(value.posterPath);
  const posterUrl = normalizeOptionalUrl(value.posterUrl);
  const id = normalizeOptionalString(value.id);
  const filename = normalizeOptionalString(value.filename);
  const label = normalizeOptionalString(value.label);
  const mimeType = normalizeOptionalString(value.mimeType, 256);
  const width = normalizeOptionalInteger(value.width, 1, MAX_DIMENSION);
  const height = normalizeOptionalInteger(value.height, 1, MAX_DIMENSION);
  const duration = normalizeOptionalNumber(value.duration, 0, Number.MAX_VALUE);
  const fps = normalizeOptionalNumber(value.fps, 0.000_001, MAX_FPS);
  const text = normalizeOptionalString(value.text, MAX_LONG_TEXT_LENGTH);
  const nodeId = normalizeOptionalString(value.nodeId);
  const batchIndex = normalizeOptionalInteger(value.batchIndex, 0);
  if (
    path === null
    || url === null
    || posterPath === null
    || posterUrl === null
    || id === null
    || filename === null
    || label === null
    || mimeType === null
    || width === null
    || height === null
    || duration === null
    || fps === null
    || text === null
    || nodeId === null
    || batchIndex === null
  ) {
    return null;
  }

  if (mimeType !== undefined && !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+*-]+(?:\s*;[^\r\n]*)?$/u.test(mimeType)) {
    return null;
  }

  let metadata: ArtifactMetadata | undefined;
  if (value.metadata !== undefined) {
    metadata = normalizeMetadata(value.metadata) ?? undefined;
    if (!metadata) return null;
  }

  const kind = value.kind as ArtifactKind;
  if (path === undefined && url === undefined && !(kind === "text" && text !== undefined)) {
    return null;
  }

  const artifact: ArtifactV1 = { kind };
  assignOptional(artifact, "id", id);
  assignOptional(artifact, "path", path);
  assignOptional(artifact, "url", url);
  assignOptional(artifact, "filename", filename);
  assignOptional(artifact, "label", label);
  assignOptional(artifact, "mimeType", mimeType);
  assignOptional(artifact, "width", width);
  assignOptional(artifact, "height", height);
  assignOptional(artifact, "duration", duration);
  assignOptional(artifact, "fps", fps);
  assignOptional(artifact, "posterPath", posterPath);
  assignOptional(artifact, "posterUrl", posterUrl);
  assignOptional(artifact, "text", text);
  assignOptional(artifact, "nodeId", nodeId);
  assignOptional(artifact, "batchIndex", batchIndex);
  assignOptional(artifact, "metadata", metadata);
  return artifact;
}

function normalizeError(value: unknown): ArtifactErrorV1 | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ERROR_KEYS)) return null;
  const message = normalizeString(value.message, 16_384);
  const code = normalizeOptionalString(value.code);
  const nodeId = normalizeOptionalString(value.nodeId);
  const details = normalizeOptionalString(value.details, MAX_LONG_TEXT_LENGTH);
  if (!message || code === null || nodeId === null || details === null) return null;

  const error: ArtifactErrorV1 = { message };
  assignOptional(error, "code", code);
  assignOptional(error, "nodeId", nodeId);
  assignOptional(error, "details", details);
  return error;
}

function normalizeTimestamp(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const timestamp = normalizeString(value, 64);
  if (!timestamp || !/^\d{4}-\d{2}-\d{2}T/u.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

export function parseArtifactBundle(value: unknown): ArtifactBundleV1 | null {
  if (!isRecord(value) || !hasOnlyKeys(value, BUNDLE_KEYS)) return null;
  if (value.schema !== ARTIFACT_BUNDLE_SCHEMA) return null;
  if (!ARTIFACT_BUNDLE_STATUSES.includes(value.status as ArtifactBundleStatus)) return null;

  const provider = normalizeString(value.provider, 128);
  const runId = normalizeString(value.runId, 512);
  const revision = normalizeOptionalInteger(value.revision, 0);
  const title = normalizeOptionalString(value.title, 1_024);
  const summary = normalizeOptionalString(value.summary, 16_384);
  const createdAt = normalizeTimestamp(value.createdAt);
  const completedAt = normalizeTimestamp(value.completedAt);
  const elapsedMs = normalizeOptionalNumber(value.elapsedMs, 0, Number.MAX_SAFE_INTEGER);
  if (
    !provider
    || !runId
    || revision === null
    || title === null
    || summary === null
    || createdAt === null
    || completedAt === null
    || elapsedMs === null
  ) {
    return null;
  }

  if (!Array.isArray(value.artifacts) || value.artifacts.length > MAX_ARTIFACTS) return null;
  const artifacts: ArtifactV1[] = [];
  for (const rawArtifact of value.artifacts) {
    const artifact = normalizeArtifact(rawArtifact);
    if (!artifact) return null;
    artifacts.push(artifact);
  }

  let workflow: ArtifactWorkflowV1 | undefined;
  if (value.workflow !== undefined) {
    workflow = normalizeWorkflow(value.workflow) ?? undefined;
    if (!workflow) return null;
  }

  let progress: ArtifactProgressV1 | undefined;
  if (value.progress !== undefined) {
    progress = normalizeProgress(value.progress) ?? undefined;
    if (!progress) return null;
  }

  let errors: ArtifactErrorV1[] | undefined;
  let error: ArtifactErrorV1 | undefined;
  if (value.error !== undefined) {
    error = normalizeError(value.error) ?? undefined;
    if (!error) return null;
  }
  if (value.errors !== undefined) {
    if (!Array.isArray(value.errors) || value.errors.length === 0 || value.errors.length > MAX_ERRORS) return null;
    errors = [];
    for (const rawError of value.errors) {
      const error = normalizeError(rawError);
      if (!error) return null;
      errors.push(error);
    }
  }
  if (error && errors) return null;

  const bundle: ArtifactBundleV1 = {
    schema: ARTIFACT_BUNDLE_SCHEMA,
    provider,
    runId,
    status: value.status as ArtifactBundleStatus,
    artifacts,
  };
  assignOptional(bundle, "revision", revision);
  assignOptional(bundle, "title", title);
  assignOptional(bundle, "summary", summary);
  assignOptional(bundle, "createdAt", createdAt);
  assignOptional(bundle, "completedAt", completedAt);
  assignOptional(bundle, "elapsedMs", elapsedMs);
  assignOptional(bundle, "workflow", workflow);
  assignOptional(bundle, "progress", progress);
  assignOptional(bundle, "error", error);
  assignOptional(bundle, "errors", errors);
  return bundle;
}

const TERMINAL_ARTIFACT_STATUSES = new Set<ArtifactBundleStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

function artifactBundleIdentity(bundle: ArtifactBundleV1): string {
  return `${bundle.provider}\u0000${bundle.runId}`;
}

function shouldReplaceArtifactBundle(
  current: ArtifactBundleV1,
  next: ArtifactBundleV1,
): boolean {
  const currentTerminal = TERMINAL_ARTIFACT_STATUSES.has(current.status);
  const nextTerminal = TERMINAL_ARTIFACT_STATUSES.has(next.status);
  if (currentTerminal && !nextTerminal) return false;
  if (!currentTerminal && nextTerminal) return true;
  if (current.revision !== undefined && next.revision !== undefined) {
    return next.revision >= current.revision;
  }
  return true;
}

export function getArtifactBundleFromMessage(message: AgentMessage): ArtifactBundleV1 | null {
  if (
    message.role !== "custom"
    || message.customType !== ARTIFACT_BUNDLE_CUSTOM_TYPE
    || message.display === false
  ) {
    return null;
  }
  return parseArtifactBundle(message.details);
}

export function isArtifactBundleMessage(message: AgentMessage): boolean {
  return getArtifactBundleFromMessage(message) !== null;
}

export function artifactProgressEntryToMessage(entry: SessionEntry): CustomMessage | null {
  if (entry.type !== "custom" || entry.customType !== ARTIFACT_PROGRESS_ENTRY_CUSTOM_TYPE) {
    return null;
  }
  const bundle = parseArtifactBundle(entry.data);
  if (!bundle) return null;
  return {
    role: "custom",
    customType: ARTIFACT_BUNDLE_CUSTOM_TYPE,
    content: "ComfyUI progress",
    display: true,
    details: bundle,
    timestamp: Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : undefined,
  };
}

/**
 * Collapse append-only artifact snapshots without disturbing unrelated message
 * ordering. The first slot is retained while the newest valid revision wins;
 * once a run is terminal, a delayed queued/running snapshot cannot resurrect it.
 */
export function collapseArtifactBundleMessagePairs(
  messages: readonly AgentMessage[],
  entryIds?: readonly string[],
): { messages: AgentMessage[]; entryIds?: string[] } {
  const collapsedMessages: AgentMessage[] = [];
  const collapsedEntryIds = entryIds ? [] as string[] : undefined;
  const positions = new Map<string, { index: number; bundle: ArtifactBundleV1 }>();

  messages.forEach((message, sourceIndex) => {
    const bundle = getArtifactBundleFromMessage(message);
    if (!bundle) {
      collapsedMessages.push(message);
      if (collapsedEntryIds) collapsedEntryIds.push(entryIds?.[sourceIndex] ?? "");
      return;
    }

    const identity = artifactBundleIdentity(bundle);
    const previous = positions.get(identity);
    if (!previous) {
      const index = collapsedMessages.length;
      collapsedMessages.push(message);
      if (collapsedEntryIds) collapsedEntryIds.push(entryIds?.[sourceIndex] ?? "");
      positions.set(identity, { index, bundle });
      return;
    }

    if (!shouldReplaceArtifactBundle(previous.bundle, bundle)) return;
    collapsedMessages[previous.index] = message;
    if (collapsedEntryIds) collapsedEntryIds[previous.index] = entryIds?.[sourceIndex] ?? "";
    positions.set(identity, { index: previous.index, bundle });
  });

  return { messages: collapsedMessages, entryIds: collapsedEntryIds };
}

export function upsertArtifactBundleMessage(
  messages: readonly AgentMessage[],
  message: AgentMessage,
): AgentMessage[] {
  if (!isArtifactBundleMessage(message)) return [...messages, message];
  return collapseArtifactBundleMessagePairs([...messages, message]).messages;
}

export function isRerunnableArtifactRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

export function getRerunnableArtifactRunId(bundle: ArtifactBundleV1): string | null {
  return bundle.provider === "comfyui"
    && TERMINAL_ARTIFACT_STATUSES.has(bundle.status)
    && isRerunnableArtifactRunId(bundle.runId)
    ? bundle.runId
    : null;
}
