import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  buildSessionContext,
  readSessionHeader,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/session-path";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import {
  createSessionRevision,
  getCachedSessionResponse,
  requestMatchesRevision,
  setCachedSessionResponse,
} from "@/lib/session-response-cache";
import { paginateSessionContext, parseSessionMessageLimit } from "@/lib/session-pagination";
import { summarizeSessionMessages } from "@/lib/session-message-stats";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const messageLimit = parseSessionMessageLimit(searchParams.get("limit"));
    const responseScope = `full:${deferThinking ? 1 : 0}:${deferToolResultImages ? 1 : 0}:${messageLimit ?? "all"}`;
    const persistedStat = !liveRpc && resolvedPath ? statSync(resolvedPath) : null;
    const revision = persistedStat
      ? createSessionRevision(persistedStat, responseScope)
      : null;
    const responseCacheKey = resolvedPath
      ? `${sessionPathKey(resolvedPath)}:${responseScope}`
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

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(resolvedPath!);
    const filePath = liveRpc?.sessionFile || sm.getSessionFile() || resolvedPath || "";
    const entries = sm.getEntries();
    const leafId = sm.getLeafId();
    const tree = projectTreeForResponse(sm.getTree());
    const fullContext = buildSessionContext(entries as never, leafId, { deferThinking, deferToolResultImages });
    const messageStats = summarizeSessionMessages(fullContext.messages);
    if (persistedStat && resolvedPath) {
      const contextScope = `context-base:${leafId ?? "null"}:${deferThinking ? 1 : 0}:${deferToolResultImages ? 1 : 0}`;
      setCachedSessionResponse(
        `${sessionPathKey(resolvedPath)}:${contextScope}`,
        createSessionRevision(persistedStat, contextScope),
        { context: fullContext, messageStats },
      );
    }
    const context = paginateSessionContext(fullContext, messageLimit);
    const totalActiveMs = computeSessionTotalActiveMs(entries);

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    if (persistedStat) modified = persistedStat.mtime.toISOString();
    else try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      modified,
      messageCount: fullContext.messages.length,
      firstMessage: fullContext.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = fullContext.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
      transient: !filePath || !existsSync(filePath),
    } : null;

    const responseData = {
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
      messageStats,
      totalActiveMs,
    };
    if (revision && responseCacheKey) {
      setCachedSessionResponse(responseCacheKey, revision, responseData);
    }
    return NextResponse.json(responseData, { headers: revisionHeaders });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the bounded header before deleting.
    const parentSessionPath = readSessionHeader(filePath)?.parentSession;

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    const targetPathKey = sessionPathKey(filePath);
    const dir = dirname(filePath);
    try {
      const files = readdirSync(dir).filter(
        (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
      );
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
          if (
            header.type === "session" &&
            header.parentSession &&
            sessionPathKey(header.parentSession) === targetPathKey
          ) {
            // Rewrite header with new parentSession
            header.parentSession = parentSessionPath;
            lines[0] = JSON.stringify(header);
            writeFileSync(childPath, lines.join("\n"));
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if dir unreadable */ }

    await getRpcSession(id)?.shutdown();
    unlinkSync(filePath);
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
