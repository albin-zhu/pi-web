import type { AgentMessage } from "./types";

export const SESSION_VIEW_CACHE_LIMIT = 6;

export interface SessionViewUiState {
  scrollTop: number;
  visibleCount: number;
  atTail: boolean;
}

export interface SessionViewSnapshot<TData = unknown> {
  data: TData;
  messages: AgentMessage[];
  entryIds: string[];
  activeLeafId: string | null;
  cachedAt: number;
  ui?: SessionViewUiState;
}

type StoredSnapshot = SessionViewSnapshot<unknown>;

declare global {
  var __piSessionViewCache: Map<string, StoredSnapshot> | undefined;
}

function cache(): Map<string, StoredSnapshot> {
  if (!globalThis.__piSessionViewCache) globalThis.__piSessionViewCache = new Map();
  return globalThis.__piSessionViewCache;
}

function trimCache(entries: Map<string, StoredSnapshot>): void {
  while (entries.size > SESSION_VIEW_CACHE_LIMIT) {
    const oldest = entries.keys().next().value as string | undefined;
    if (!oldest) return;
    entries.delete(oldest);
  }
}

/** Read and promote a snapshot in the small in-memory LRU. */
export function getSessionViewSnapshot<TData = unknown>(sessionId: string): SessionViewSnapshot<TData> | undefined {
  const entries = cache();
  const snapshot = entries.get(sessionId);
  if (!snapshot) return undefined;
  entries.delete(sessionId);
  entries.set(sessionId, snapshot);
  return snapshot as SessionViewSnapshot<TData>;
}

/** Store data while preserving UI state captured by ChatWindow. */
export function setSessionViewSnapshot<TData>(
  sessionId: string,
  snapshot: Omit<SessionViewSnapshot<TData>, "ui"> & { ui?: SessionViewUiState },
): void {
  const entries = cache();
  const previous = entries.get(sessionId);
  entries.delete(sessionId);
  entries.set(sessionId, {
    ...snapshot,
    ui: snapshot.ui ?? previous?.ui,
  } as StoredSnapshot);
  trimCache(entries);
}

export function updateSessionViewUi(sessionId: string, ui: SessionViewUiState): void {
  const entries = cache();
  const snapshot = entries.get(sessionId);
  if (!snapshot) return;
  entries.delete(sessionId);
  entries.set(sessionId, { ...snapshot, ui });
}

export function deleteSessionViewSnapshot(sessionId: string): void {
  cache().delete(sessionId);
}

/** Test helper; the cache is intentionally process-local and never persisted. */
export function clearSessionViewCache(): void {
  cache().clear();
}
