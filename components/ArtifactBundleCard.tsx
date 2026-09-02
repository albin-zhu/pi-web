"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { ArtifactBundleV1, ArtifactV1 } from "@/lib/artifact-bundle";
import { getRerunnableArtifactRunId } from "@/lib/artifact-bundle";
import {
  getFileApiUrl,
  getFileName,
  getRelativeFilePath,
  isNetworkOrDeviceFileApiUrl,
  isNetworkOrDeviceFilePath,
  isWindowsDeviceFilePath,
} from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";
import { getFileIcon } from "./FileIcons";
import { ImagePreview } from "./ImagePreview";

export interface ArtifactBundleCardProps {
  bundle: ArtifactBundleV1;
  cwd?: string;
  sessionId?: string;
  onOpenFile?: (filePath: string) => void;
  onRerun?: (runId: string) => boolean;
  rerunDisabled?: boolean;
}

const CARD_STYLE: CSSProperties = {
  marginBottom: 16,
  overflow: "hidden",
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "var(--bg)",
};

const CHIP_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minWidth: 0,
  maxWidth: "100%",
  padding: "2px 7px",
  border: "1px solid var(--border)",
  borderRadius: 999,
  background: "var(--bg-subtle)",
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  lineHeight: 1.5,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const ACTION_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  padding: 0,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-subtle)",
  color: "var(--text-muted)",
  cursor: "pointer",
  textDecoration: "none",
};

const RERUN_STYLE: CSSProperties = {
  ...ACTION_STYLE,
  width: "auto",
  padding: "0 9px",
  gap: 5,
  fontSize: 10,
  fontWeight: 650,
};

function isSafeLocalArtifactPath(filePath: string): boolean {
  return !isNetworkOrDeviceFilePath(filePath) && !isWindowsDeviceFilePath(filePath, true);
}

function statusPresentation(status: ArtifactBundleV1["status"]): {
  color: string;
  background: string;
} {
  switch (status) {
    case "succeeded":
      return { color: "#22c55e", background: "rgba(34, 197, 94, 0.12)" };
    case "failed":
      return { color: "#ef4444", background: "rgba(239, 68, 68, 0.12)" };
    case "cancelled":
      return { color: "var(--text-dim)", background: "var(--bg-subtle)" };
    case "running":
      return { color: "var(--accent)", background: "var(--bg-selected)" };
    case "queued":
      return { color: "#eab308", background: "rgba(234, 179, 8, 0.12)" };
    default:
      return { color: "var(--text-muted)", background: "var(--bg-subtle)" };
  }
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function mediaSource(
  artifact: ArtifactV1,
  sessionId?: string,
): string | undefined {
  if (artifact.path && isSafeLocalArtifactPath(artifact.path)) {
    return getFileApiUrl(artifact.path, "read", sessionId);
  }
  // External media stays click-to-open. Rendering it eagerly would make simply
  // opening a session issue requests to arbitrary hosts supplied by a package.
  return artifact.url?.startsWith("/api/files/") && !isNetworkOrDeviceFileApiUrl(artifact.url, true)
    ? artifact.url
    : undefined;
}

function posterSource(
  artifact: ArtifactV1,
  sessionId?: string,
): string | undefined {
  if (artifact.posterPath && isSafeLocalArtifactPath(artifact.posterPath)) {
    return getFileApiUrl(artifact.posterPath, "read", sessionId);
  }
  return artifact.posterUrl?.startsWith("/api/files/") && !isNetworkOrDeviceFileApiUrl(artifact.posterUrl, true)
    ? artifact.posterUrl
    : undefined;
}

function artifactName(artifact: ArtifactV1, index: number): string {
  return artifact.label
    ?? artifact.filename
    ?? (artifact.path ? getFileName(artifact.path) : undefined)
    ?? `${artifact.kind} ${index + 1}`;
}

function artifactKey(artifact: ArtifactV1, index: number): string {
  return artifact.id ?? artifact.path ?? artifact.url ?? `${artifact.kind}-${index}`;
}

function OpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3h7v7" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function RerunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.34 5.66" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function ArtifactActions({
  artifact,
  name,
  sessionId,
  onOpenFile,
}: {
  artifact: ArtifactV1;
  name: string;
  sessionId?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const safeLocalPath = artifact.path && isSafeLocalArtifactPath(artifact.path)
    ? artifact.path
    : undefined;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
      {safeLocalPath && onOpenFile && (
        <button
          type="button"
          style={ACTION_STYLE}
          onClick={() => onOpenFile(safeLocalPath)}
          title={t("chat.openWrittenFile", { name })}
          aria-label={t("chat.openWrittenFile", { name })}
        >
          <OpenIcon />
        </button>
      )}
      {safeLocalPath && (
        <a
          style={ACTION_STYLE}
          href={getFileApiUrl(safeLocalPath, "download", sessionId)}
          download={artifact.filename ?? getFileName(safeLocalPath)}
          title={t("i18n.downloadFile")}
          aria-label={t("i18n.downloadFile")}
        >
          <DownloadIcon />
        </a>
      )}
      {!artifact.path && artifact.url && (
        <a
          style={ACTION_STYLE}
          href={artifact.url}
          target="_blank"
          rel="noreferrer"
          title={name}
          aria-label={name}
        >
          <OpenIcon />
        </a>
      )}
    </div>
  );
}

function ArtifactFooter({
  artifact,
  index,
  cwd,
  sessionId,
  onOpenFile,
}: {
  artifact: ArtifactV1;
  index: number;
  cwd?: string;
  sessionId?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const name = artifactName(artifact, index);
  const displayPath = artifact.path
    ? getRelativeFilePath(artifact.path, cwd)
    : artifact.filename ?? name;
  const facts = [
    artifact.width && artifact.height ? `${artifact.width}×${artifact.height}` : null,
    artifact.duration !== undefined ? formatDuration(artifact.duration) : null,
    artifact.fps !== undefined ? `${artifact.fps} fps` : null,
  ].filter(Boolean);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderTop: "1px solid var(--border)", minWidth: 0 }}>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div title={artifact.path ?? artifact.url ?? name} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayPath}
        </div>
        {facts.length > 0 && (
          <div style={{ marginTop: 2, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 9 }}>
            {facts.join(" · ")}
          </div>
        )}
      </div>
      <ArtifactActions artifact={artifact} name={name} sessionId={sessionId} onOpenFile={onOpenFile} />
    </div>
  );
}

function EmptyPreview({ artifact, index }: { artifact: ArtifactV1; index: number }) {
  const name = artifactName(artifact, index);
  return (
    <div style={{ display: "flex", minHeight: 132, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, padding: 16, background: "var(--bg-subtle)", color: "var(--text-dim)" }}>
      {getFileIcon(artifact.filename ?? artifact.path ?? name, 30)}
      <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 11 }}>{name}</span>
    </div>
  );
}

function ArtifactTile({
  artifact,
  index,
  activeVideoKey,
  autoPlayVideoKey,
  activateVideo,
  cwd,
  sessionId,
  onOpenFile,
}: {
  artifact: ArtifactV1;
  index: number;
  activeVideoKey: string | null;
  autoPlayVideoKey: string | null;
  activateVideo: (key: string) => void;
  cwd?: string;
  sessionId?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const source = mediaSource(artifact, sessionId);
  const poster = posterSource(artifact, sessionId);
  const name = artifactName(artifact, index);
  const key = artifactKey(artifact, index);
  let preview: ReactNode;

  if (artifact.kind === "image" && source) {
    preview = (
      <ImagePreview src={source} alt={name} style={{ width: "100%", height: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source} alt={name} loading="lazy" style={{ display: "block", width: "100%", height: "100%", minHeight: 160, maxHeight: 320, objectFit: "contain", background: "var(--bg-subtle)" }} />
      </ImagePreview>
    );
  } else if (artifact.kind === "video" && source) {
    if (activeVideoKey === key) {
      preview = (
        <video
          key={source}
          src={source}
          poster={poster}
          controls
          autoPlay={autoPlayVideoKey === key}
          preload="metadata"
          playsInline
          aria-label={name}
          style={{ display: "block", width: "100%", minHeight: 160, maxHeight: 360, background: "#000", objectFit: "contain" }}
        />
      );
    } else {
      preview = (
        <button
          type="button"
          onClick={() => activateVideo(key)}
          aria-label={t("artifact.play", { name })}
          title={name}
          style={{ position: "relative", display: "flex", width: "100%", minHeight: 160, padding: 0, border: 0, alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#111", color: "white", cursor: "pointer" }}
        >
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.78 }} />
          )}
          <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: "50%", background: "rgba(0, 0, 0, 0.62)", boxShadow: "0 4px 18px rgba(0, 0, 0, 0.35)" }}>
            <PlayIcon />
          </span>
        </button>
      );
    }
  } else if (artifact.kind === "audio" && source) {
    preview = (
      <div style={{ display: "flex", minHeight: 132, alignItems: "center", padding: "20px 14px", background: "var(--bg-subtle)" }}>
        <audio src={source} controls preload="metadata" aria-label={name} style={{ width: "100%" }} />
      </div>
    );
  } else if (artifact.kind === "text" && artifact.text !== undefined) {
    preview = (
      <pre style={{ minHeight: 132, maxHeight: 260, margin: 0, padding: 12, overflow: "auto", background: "var(--bg-subtle)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {artifact.text}
      </pre>
    );
  } else {
    preview = <EmptyPreview artifact={artifact} index={index} />;
  }

  return (
    <article style={{ minWidth: 0, overflow: "hidden", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}>
      {preview}
      <ArtifactFooter artifact={artifact} index={index} cwd={cwd} sessionId={sessionId} onOpenFile={onOpenFile} />
    </article>
  );
}

function metadataChips(bundle: ArtifactBundleV1): Array<{ label: string; title?: string }> {
  const workflow = bundle.workflow;
  const chips: Array<{ label: string; title?: string } | null> = [
    workflow?.name ? { label: workflow.name, title: "Workflow" } : null,
    workflow?.model ? { label: workflow.model, title: "Model" } : null,
    workflow?.checkpoint ? { label: workflow.checkpoint, title: "Checkpoint" } : null,
    workflow?.width && workflow.height ? { label: `${workflow.width}×${workflow.height}`, title: "Dimensions" } : null,
    workflow?.duration !== undefined ? { label: formatDuration(workflow.duration), title: "Duration" } : null,
    workflow?.fps !== undefined ? { label: `${workflow.fps} fps`, title: "Frame rate" } : null,
    workflow?.seed !== undefined ? { label: `seed ${workflow.seed}`, title: "Seed" } : null,
    workflow?.sampler ? { label: workflow.sampler, title: "Sampler" } : null,
    workflow?.scheduler ? { label: workflow.scheduler, title: "Scheduler" } : null,
    workflow?.steps !== undefined ? { label: `${workflow.steps} steps`, title: "Steps" } : null,
    workflow?.cfg !== undefined ? { label: `CFG ${workflow.cfg}`, title: "CFG" } : null,
  ];
  return chips.filter((chip): chip is { label: string; title?: string } => chip !== null);
}

function normalizedProgress(bundle: ArtifactBundleV1): number | null {
  const progress = bundle.progress;
  if (!progress) return null;
  if (progress.percent !== undefined && Number.isFinite(progress.percent)) {
    return Math.min(100, Math.max(0, progress.percent));
  }
  if (progress.value !== undefined && progress.max !== undefined && progress.max > 0) {
    return Math.min(100, Math.max(0, progress.value / progress.max * 100));
  }
  return null;
}

export function ArtifactBundleCard({ bundle, cwd, sessionId, onOpenFile, onRerun, rerunDisabled = false }: ArtifactBundleCardProps) {
  const { t } = useI18n();
  const status = statusPresentation(bundle.status);
  const statusLabel = t(`artifact.status.${bundle.status}`);
  const chips = useMemo(() => metadataChips(bundle), [bundle]);
  const progress = normalizedProgress(bundle);
  const initialVideo = useMemo(() => {
    const firstVideoIndex = bundle.artifacts.findIndex((artifact) => artifact.kind === "video");
    return firstVideoIndex >= 0 ? artifactKey(bundle.artifacts[firstVideoIndex], firstVideoIndex) : null;
  }, [bundle.artifacts]);
  const [activeVideoKey, setActiveVideoKey] = useState<string | null>(initialVideo);
  const [autoPlayVideoKey, setAutoPlayVideoKey] = useState<string | null>(null);
  const [rerunFeedback, setRerunFeedback] = useState<"prepared" | "blocked" | null>(null);
  const activateVideo = (key: string) => {
    setActiveVideoKey(key);
    setAutoPlayVideoKey(key);
  };
  const title = bundle.title ?? bundle.workflow?.name ?? (bundle.provider === "comfyui" ? "ComfyUI" : bundle.provider);
  const progressLabel = bundle.progress?.message
    ?? bundle.progress?.nodeTitle
    ?? (bundle.progress?.nodeId ? `Node ${bundle.progress.nodeId}` : null);
  const errors = bundle.error ? [bundle.error] : bundle.errors ?? [];
  const rerunRunId = getRerunnableArtifactRunId(bundle);
  const terminal = bundle.status === "succeeded" || bundle.status === "failed" || bundle.status === "cancelled";
  const showProgress = bundle.status === "queued"
    || bundle.status === "running"
    || progress !== null
    || Boolean(progressLabel)
    || bundle.progress?.queuePosition !== undefined;

  const handleRerun = () => {
    if (!rerunRunId || !onRerun || rerunDisabled) return;
    setRerunFeedback(onRerun(rerunRunId) ? "prepared" : "blocked");
  };

  return (
    <section style={CARD_STYLE} aria-label={title}>
      <header style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, padding: "8px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, flexShrink: 0, borderRadius: "50%", background: status.color, boxShadow: bundle.status === "running" ? `0 0 0 3px ${status.background}` : undefined }} />
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
            <strong title={title} style={{ overflow: "hidden", color: "var(--text)", fontSize: 12, fontWeight: 650, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</strong>
            <span style={{ padding: "1px 6px", borderRadius: 999, background: status.background, color: status.color, fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{statusLabel}</span>
          </div>
          <div style={{ marginTop: 2, overflow: "hidden", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 9, textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={bundle.runId}>
            {bundle.runId}
          </div>
        </div>
        {bundle.elapsedMs !== undefined && (
          <span title={t("artifact.elapsedTime")} style={{ flexShrink: 0, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{formatElapsed(bundle.elapsedMs)}</span>
        )}
        {rerunRunId && onRerun && (
          <button
            type="button"
            style={{
              ...RERUN_STYLE,
              opacity: rerunDisabled ? 0.5 : 1,
              cursor: rerunDisabled ? "not-allowed" : "pointer",
            }}
            disabled={rerunDisabled}
            onClick={handleRerun}
            title={t("artifact.rerun")}
            aria-label={t("artifact.rerun")}
          >
            <RerunIcon />
            <span>{t("artifact.rerun")}</span>
          </button>
        )}
      </header>

      {rerunFeedback && (
        <div role="status" style={{ padding: "5px 10px", borderBottom: "1px solid var(--border)", color: rerunFeedback === "prepared" ? "var(--accent)" : "var(--text-muted)", fontSize: 10 }}>
          {t(rerunFeedback === "prepared" ? "artifact.rerunPrepared" : "artifact.rerunBlocked")}
        </div>
      )}

      {showProgress && (
        <div role="status" aria-live="polite" style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, color: "var(--text-muted)", fontSize: 10 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{progressLabel ?? statusLabel}</span>
            <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
              {bundle.progress?.queuePosition !== undefined ? t("artifact.queue", { position: bundle.progress.queuePosition }) : null}
              {bundle.progress?.queuePosition !== undefined && progress !== null ? " · " : null}
              {progress !== null ? `${Math.round(progress)}%` : null}
            </span>
          </div>
          {(progress !== null || bundle.status === "queued" || bundle.status === "running") && (
            <div
              role="progressbar"
              aria-label={progressLabel ?? t("artifact.progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress === null ? undefined : Math.round(progress)}
              aria-valuetext={progress === null ? statusLabel : `${Math.round(progress)}%`}
              style={{ height: 3, marginTop: 6, overflow: "hidden", borderRadius: 999, background: "var(--border)" }}
            >
              <div
                className={progress === null ? "artifact-progress-indeterminate" : undefined}
                style={{
                  width: progress === null ? "36%" : `${progress}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: status.color,
                  transition: progress === null ? undefined : "width 180ms ease",
                }}
              />
            </div>
          )}
        </div>
      )}

      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>
          {chips.map((chip, index) => <span key={`${chip.label}-${index}`} style={CHIP_STYLE} title={chip.title ? `${chip.title}: ${chip.label}` : chip.label}>{chip.label}</span>)}
        </div>
      )}

      {bundle.summary && (
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {bundle.summary}
        </div>
      )}

      {(bundle.artifacts.length > 0 || terminal) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 8, padding: 9 }}>
          {bundle.artifacts.map((artifact, index) => (
            <ArtifactTile
              key={`${artifactKey(artifact, index)}-${index}`}
              artifact={artifact}
              index={index}
              activeVideoKey={activeVideoKey}
              autoPlayVideoKey={autoPlayVideoKey}
              activateVideo={activateVideo}
              cwd={cwd}
              sessionId={sessionId}
              onOpenFile={onOpenFile}
            />
          ))}
          {bundle.artifacts.length === 0 && (
            <div style={{ padding: "18px 10px", color: "var(--text-dim)", fontSize: 11, textAlign: "center" }}>{t("artifact.noArtifacts")}</div>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" style={{ padding: "8px 10px", borderTop: "1px solid var(--border)", background: "rgba(239, 68, 68, 0.07)", color: "#ef4444", fontSize: 11 }}>
          {errors.map((error, index) => (
            <div key={`${error.code ?? "error"}-${index}`}>
              {error.nodeId ? `Node ${error.nodeId}: ` : ""}{error.message}
            </div>
          ))}
        </div>
      )}

      {(bundle.workflow?.path || bundle.workflow?.url || bundle.workflow?.hash) && (
        <footer style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "6px 10px", borderTop: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 9 }}>
          <span style={{ flexShrink: 0 }}>{t("artifact.workflow")}</span>
          <span title={bundle.workflow.path ?? bundle.workflow.url ?? bundle.workflow.hash} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {bundle.workflow.path ? getRelativeFilePath(bundle.workflow.path, cwd) : bundle.workflow.url ?? bundle.workflow.hash}
          </span>
          {bundle.workflow.path && onOpenFile && (
            <button type="button" style={{ ...ACTION_STYLE, marginLeft: "auto", flexShrink: 0 }} onClick={() => onOpenFile(bundle.workflow!.path!)} title={t("artifact.openWorkflow")} aria-label={t("artifact.openWorkflow")}>
              <OpenIcon />
            </button>
          )}
        </footer>
      )}
    </section>
  );
}
