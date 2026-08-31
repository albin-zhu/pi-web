import type { AgentMessage } from "./types";
import { SESSION_MESSAGE_PAGE_SIZE } from "./session-pagination";
import { getSessionViewSnapshot, setSessionViewSnapshot } from "./session-view-cache";

interface SessionViewDataLike {
  sessionId: string;
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
  };
}

export type SessionViewLoadResult<TData> =
  | { status: "loaded"; data: TData; revision?: string }
  | { status: "unchanged" }
  | { status: "missing" };

const inFlight = new Map<string, Promise<SessionViewLoadResult<SessionViewDataLike>>>();

export function loadSessionView<TData extends SessionViewDataLike>(
  sessionId: string,
  revision?: string | null,
): Promise<SessionViewLoadResult<TData>> {
  const existing = inFlight.get(sessionId);
  if (existing) return existing as Promise<SessionViewLoadResult<TData>>;

  const params = new URLSearchParams({
    deferThinking: "1",
    deferMedia: "1",
    limit: String(SESSION_MESSAGE_PAGE_SIZE),
  });
  const request = fetch(`/api/sessions/${encodeURIComponent(sessionId)}?${params}`, {
    headers: revision ? { "If-None-Match": revision } : undefined,
  }).then(async (response): Promise<SessionViewLoadResult<SessionViewDataLike>> => {
    if (response.status === 404) return { status: "missing" };
    if (response.status === 304) return { status: "unchanged" };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      status: "loaded",
      data: await response.json() as SessionViewDataLike,
      revision: response.headers.get("etag") ?? undefined,
    };
  }).finally(() => {
    if (inFlight.get(sessionId) === request) inFlight.delete(sessionId);
  });

  inFlight.set(sessionId, request);
  return request as Promise<SessionViewLoadResult<TData>>;
}

/** Hover-intent prefetch. The normal session loader shares this exact request. */
export async function prefetchSessionView(sessionId: string): Promise<void> {
  if (getSessionViewSnapshot(sessionId)) return;
  try {
    const result = await loadSessionView<SessionViewDataLike>(sessionId);
    if (result.status !== "loaded") return;
    setSessionViewSnapshot(sessionId, {
      data: result.data,
      messages: result.data.context.messages,
      entryIds: result.data.context.entryIds ?? [],
      activeLeafId: result.data.leafId,
      cachedAt: Date.now(),
      revision: result.revision,
    });
  } catch {
    // Prefetch is opportunistic; the foreground loader reports real failures.
  }
}

export function clearSessionViewLoadersForTest(): void {
  inFlight.clear();
}
