export function normalizeFilePathSlashes(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

const API_UNC_PREFIX = "__pi_unc_path_v1__";
const API_ROOT_ESCAPE_PREFIX = "__pi_root_path_v1__";
const WINDOWS_RESERVED_DEVICE_BASENAME = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM(?:[1-9]|[\u00b9\u00b2\u00b3])|LPT(?:[1-9]|[\u00b9\u00b2\u00b3]))$/iu;

/** Reject Windows device aliases and path components with ambiguous Win32 normalization. */
export function isUnsafeWindowsPathSegment(segment: string): boolean {
  if (!segment || /[<>:"|?*\u0000-\u001f]/u.test(segment) || /[ .]$/u.test(segment)) {
    return true;
  }
  const withoutAds = segment.split(":", 1)[0];
  const firstDot = withoutAds.indexOf(".");
  const basename = (firstDot < 0 ? withoutAds : withoutAds.slice(0, firstDot))
    .replace(/[ .]+$/u, "");
  return WINDOWS_RESERVED_DEVICE_BASENAME.test(basename);
}

export function isNetworkOrDeviceFilePath(filePath: string): boolean {
  return filePath.replace(/\\/g, "/").startsWith("//");
}

export function isWindowsDeviceFilePath(
  filePath: string,
  includeRootRelative = false,
): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (/^\/\/[?.](?:\/|$)/u.test(normalized)) return true;
  if (/^[A-Za-z]:\//u.test(normalized)) {
    return normalized.slice(3).split("/").some(isUnsafeWindowsPathSegment);
  }
  if (includeRootRelative && normalized.startsWith("/") && !normalized.startsWith("//")) {
    return normalized.slice(1).split("/").some(isUnsafeWindowsPathSegment);
  }
  return false;
}

export function isNetworkOrDeviceFileApiUrl(
  value: string,
  includeWindowsRootRelative = false,
): boolean {
  try {
    const parsed = new URL(value, "http://pi-web.local");
    if (parsed.origin !== "http://pi-web.local" || !parsed.pathname.startsWith("/api/files/")) {
      return false;
    }
    const segments = parsed.pathname
      .slice("/api/files/".length)
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const filePath = decodeFilePathFromApiSegments(segments);
    return isNetworkOrDeviceFilePath(filePath)
      || isWindowsDeviceFilePath(filePath, includeWindowsRootRelative);
  } catch {
    return false;
  }
}

export function encodeFilePathForApi(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath);
  const isUnc = normalized.startsWith("//");
  const segments = normalized
    .split("/")
    .filter(Boolean);
  if (isUnc) {
    segments.unshift(API_UNC_PREFIX);
  } else if (
    normalized.startsWith("/")
    && (segments[0] === API_UNC_PREFIX || segments[0] === API_ROOT_ESCAPE_PREFIX)
  ) {
    segments.unshift(API_ROOT_ESCAPE_PREFIX);
  }
  return segments
    .map(encodeURIComponent)
    .join("/");
}

export function decodeFilePathFromApiSegments(segments: string[]): string {
  if (segments[0] === API_UNC_PREFIX) {
    return `//${segments.slice(1).join("/")}`;
  }
  const pathSegments = segments[0] === API_ROOT_ESCAPE_PREFIX ? segments.slice(1) : segments;
  const joined = pathSegments.join("/");
  if (/^[a-zA-Z]:\//.test(joined)) return joined;
  return `/${joined.replace(/^\/+/, "")}`;
}

export function getFileApiUrl(
  filePath: string,
  type: string,
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return `/api/files/${encodeFilePathForApi(filePath)}?${searchParams.toString()}`;
}

export function getFileName(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

export function getFileDirectory(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return "";
  if (lastSlash === 0) return "/";
  if (lastSlash === 2 && /^[a-zA-Z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, lastSlash);
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;

  const normalizedFile = normalizeFilePathSlashes(filePath);
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  if (normalizedFile.startsWith(normalizedCwd + "/")) {
    return normalizedFile.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

export function joinFilePath(parent: string, child: string): string {
  return `${normalizeFilePathSlashes(parent).replace(/\/$/, "")}/${child}`;
}
