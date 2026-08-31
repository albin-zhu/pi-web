export const SESSION_RESPONSE_CACHE_LIMIT = 12;

export interface SessionFileVersion {
  size: number;
  mtimeMs: number;
}

interface CachedResponse {
  revision: string;
  value: unknown;
}

declare global {
  var __piSessionResponseCache: Map<string, CachedResponse> | undefined;
}

function responseCache(): Map<string, CachedResponse> {
  if (!globalThis.__piSessionResponseCache) globalThis.__piSessionResponseCache = new Map();
  return globalThis.__piSessionResponseCache;
}

function trim(entries: Map<string, CachedResponse>): void {
  while (entries.size > SESSION_RESPONSE_CACHE_LIMIT) {
    const oldest = entries.keys().next().value as string | undefined;
    if (!oldest) return;
    entries.delete(oldest);
  }
}

function scopeToken(scope: string): string {
  let hash = 2166136261;
  for (let index = 0; index < scope.length; index += 1) {
    hash ^= scope.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createSessionRevision(version: SessionFileVersion, scope: string): string {
  const size = Math.max(0, Math.trunc(version.size)).toString(36);
  const modified = Math.max(0, Math.trunc(version.mtimeMs * 1000)).toString(36);
  return `W/"pi-session-${size}-${modified}-${scopeToken(scope)}"`;
}

export function requestMatchesRevision(ifNoneMatch: string | null, revision: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate === revision);
}

export function getCachedSessionResponse<T>(key: string, revision: string): T | undefined {
  const entries = responseCache();
  const cached = entries.get(key);
  if (!cached || cached.revision !== revision) {
    if (cached) entries.delete(key);
    return undefined;
  }
  entries.delete(key);
  entries.set(key, cached);
  return cached.value as T;
}

export function setCachedSessionResponse<T>(key: string, revision: string, value: T): void {
  const entries = responseCache();
  entries.delete(key);
  entries.set(key, { revision, value });
  trim(entries);
}

export function clearSessionResponseCache(): void {
  responseCache().clear();
}
