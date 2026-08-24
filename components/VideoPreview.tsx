"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileApiUrl, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { extractLocalMediaPaths, type MessageMediaPath } from "@/lib/media-paths";
import { ImagePreview } from "./ImagePreview";

interface ChatMediaPreviewProps {
  item: MessageMediaPath;
  cwd?: string;
  sessionId?: string;
  onOpenFile?: (filePath: string) => void;
}

function MediaPathButton({
  filePath,
  cwd,
  onOpenFile,
}: {
  filePath: string;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const label = getRelativeFilePath(filePath, cwd);
  if (!onOpenFile) {
    return <span className="chat-video-preview-name" title={filePath}>{label}</span>;
  }
  return (
    <button
      type="button"
      className="chat-video-preview-name"
      onClick={() => onOpenFile(filePath)}
      title={filePath}
    >
      {label}
    </button>
  );
}

function ChatMediaPreview({ item, cwd, sessionId, onOpenFile }: ChatMediaPreviewProps) {
  const { t } = useI18n();
  const src = getFileApiUrl(item.filePath, "read", sessionId);
  const name = getFileName(item.filePath);

  if (item.kind === "image") {
    return (
      <div className="chat-video-preview">
        <ImagePreview src={src} alt={name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="chat-media-preview-image"
            src={src}
            alt={name}
          />
        </ImagePreview>
        <MediaPathButton filePath={item.filePath} cwd={cwd} onOpenFile={onOpenFile} />
      </div>
    );
  }

  return (
    <div className="chat-video-preview">
      <video
        className="chat-video-preview-player"
        src={src}
        controls
        preload="metadata"
        playsInline
        title={name}
        aria-label={t("chat.previewVideo")}
      />
      <MediaPathButton filePath={item.filePath} cwd={cwd} onOpenFile={onOpenFile} />
    </div>
  );
}

export function MessageVideoPreviews({
  text,
  cwd,
  sessionId,
  onOpenFile,
}: {
  text: string;
  cwd?: string;
  sessionId?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const items = useMemo(() => extractLocalMediaPaths(text, cwd), [text, cwd]);
  if (items.length === 0) return null;

  return (
    <div className="chat-video-previews">
      {items.map((item) => (
        <ChatMediaPreview
          key={item.filePath}
          item={item}
          cwd={cwd}
          sessionId={sessionId}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}
