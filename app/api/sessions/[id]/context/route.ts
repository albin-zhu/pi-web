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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const responseScope = `context:${leafId ?? "default"}:${deferThinking ? 1 : 0}:${deferToolResultImages ? 1 : 0}`;
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
      const cached = getCachedSessionResponse<{ context: unknown }>(responseCacheKey, revision);
      if (cached) return NextResponse.json(cached, { headers: revisionHeaders });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!);
    const context = buildSessionContext(sm.getEntries() as never, leafId, {
      deferThinking,
      deferToolResultImages,
    });

    const responseData = { context };
    if (revision && responseCacheKey) {
      setCachedSessionResponse(responseCacheKey, revision, responseData);
    }
    return NextResponse.json(responseData, { headers: revisionHeaders });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
