import { resolveLocalFileHref } from "./file-links";
import { normalizeFilePathSlashes } from "./file-paths";
import { IMAGE_EXT_TO_MIME, VIDEO_EXT_TO_MIME, isImagePath, isVideoPath } from "./file-types";

export const MAX_MESSAGE_MEDIA_PREVIEWS = 6;
export const MAX_MESSAGE_VIDEO_PREVIEWS = MAX_MESSAGE_MEDIA_PREVIEWS;

export type MessageMediaKind = "image" | "video";

export interface MessageMediaPath {
  filePath: string;
  kind: MessageMediaKind;
}

const MEDIA_EXT = [...Object.keys(IMAGE_EXT_TO_MIME), ...Object.keys(VIDEO_EXT_TO_MIME)].join("|");
const MEDIA_PATH_RE = new RegExp(
  String.raw`(?:file://[^\s"'<>)]+|` +
  String.raw`[A-Za-z]:[\\/][^\s"'<>|*?)]+|` +
  String.raw`\\\\[^\s"'<>|*?)]+|` +
  String.raw`(?:\.\.?/)[^\s"'<>|*?)]+|` +
  String.raw`/[^\s"'<>|*?)]+)` +
  String.raw`\.(?:${MEDIA_EXT})\b`,
  "gi",
);
const MARKDOWN_LINK_RE = /!\[[^\]]*\]\(([^)]+)\)|\[[^\]]*\]\(([^)]+)\)/g;

function pathKey(filePath: string): string {
  return normalizeFilePathSlashes(filePath).toLowerCase();
}

function mediaKind(filePath: string): MessageMediaKind | null {
  if (isVideoPath(filePath)) return "video";
  if (isImagePath(filePath)) return "image";
  return null;
}

function markdownLinkedMediaPaths(text: string, cwd?: string): Set<string> {
  const paths = new Set<string>();
  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    const href = (match[1] ?? match[2] ?? "").trim();
    const resolved = resolveLocalFileHref(href, cwd);
    if (resolved && mediaKind(resolved)) paths.add(pathKey(resolved));
  }
  return paths;
}

/** Collect unique local image/video paths from message text, skipping markdown image/link targets. */
export function extractLocalMediaPaths(text: string, cwd?: string): MessageMediaPath[] {
  if (!text) return [];

  const skip = markdownLinkedMediaPaths(text, cwd);
  const seen = new Set<string>();
  const paths: MessageMediaPath[] = [];

  for (const match of text.matchAll(MEDIA_PATH_RE)) {
    const resolved = resolveLocalFileHref(match[0], cwd);
    if (!resolved) continue;
    const kind = mediaKind(resolved);
    if (!kind) continue;
    const key = pathKey(resolved);
    if (skip.has(key) || seen.has(key)) continue;
    seen.add(key);
    paths.push({ filePath: resolved, kind });
    if (paths.length >= MAX_MESSAGE_MEDIA_PREVIEWS) break;
  }

  return paths;
}

export function extractLocalVideoPaths(text: string, cwd?: string): string[] {
  return extractLocalMediaPaths(text, cwd)
    .filter((item) => item.kind === "video")
    .map((item) => item.filePath);
}
