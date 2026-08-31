import { NextResponse } from "next/server";
import { statSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { sessionPathKey } from "@/lib/session-path";
import {
  createSessionRevision,
  getCachedSessionResponse,
  requestMatchesRevision,
  setCachedSessionResponse,
} from "@/lib/session-response-cache";
import { paginateSessionContext, parseSessionMessageLimit } from "@/lib/session-pagination";
import { summarizeSessionMessages, type SessionMessageStats } from "@/lib/session-message-stats";
import type { SessionContext } from "@/lib/types";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");
  const messageLimit = parseSessionMessageLimit(url.searchParams.get("limit"));
  const beforeEntryId = url.searchParams.get("beforeEntryId");

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const responseScope = `context:${leafId ?? "default"}:${deferThinking ? 1 : 0}:${deferToolResultImages ? 1 : 0}:${messageLimit ?? "all"}:${beforeEntryId ?? "tail"}`;
    const persistedStat = !liveRpc && filePath ? statSync(filePath) : null;
    const revision = persistedStat
      ? createSessionRevision(persistedStat, responseScope)
      : null;
    const responseCacheKey = filePath
      ? `${sessionPathKey(filePath)}:${responseScope}`
      : null;
    const revisionHeaders = revision
      ? { ETag: revision, "Cache-Control": "private, no-cache" }
      : undefined;

    if (revision && requestMatchesRevision(req.headers.get("if-none-match"), revision)) {
      return new NextResponse(null, { status: 304, headers: revisionHeaders });
    }
    if (revision && responseCacheKey) {
      const cached = getCachedSessionResponse<object>(responseCacheKey, revision);
      if (cached) return NextResponse.json(cached, { headers: revisionHeaders });
    }

    const contextScope = `context-base:${leafId ?? "null"}:${deferThinking ? 1 : 0}:${deferToolResultImages ? 1 : 0}`;
    const contextCacheKey = filePath
      ? `${sessionPathKey(filePath)}:${contextScope}`
      : null;
    const contextRevision = persistedStat
      ? createSessionRevision(persistedStat, contextScope)
      : null;
    const cachedContext = contextCacheKey && contextRevision
      ? getCachedSessionResponse<{ context: SessionContext; messageStats: SessionMessageStats }>(
          contextCacheKey,
          contextRevision,
        )
      : undefined;
    const sm = cachedContext ? null : (liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!));
    const fullContext = cachedContext?.context ?? buildSessionContext(sm!.getEntries() as never, leafId, {
      deferThinking,
      deferToolResultImages,
    });
    const messageStats = cachedContext?.messageStats ?? summarizeSessionMessages(fullContext.messages);
    if (!cachedContext && contextCacheKey && contextRevision) {
      setCachedSessionResponse(contextCacheKey, contextRevision, { context: fullContext, messageStats });
    }
    const context = paginateSessionContext(fullContext, messageLimit, beforeEntryId);

    const responseData = { context, messageStats };
    if (revision && responseCacheKey) {
      setCachedSessionResponse(responseCacheKey, revision, responseData);
    }
    return NextResponse.json(responseData, { headers: revisionHeaders });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
