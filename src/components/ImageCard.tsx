import { useState as useLocalState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Stamp,
  Trash2,
  Copy,
  Link,
  Download,
  CloudOff,
  Check,
  ImageOff,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";

export type ImageStatus =
  | "pending"
  | "uploading"
  | "watermarking"
  | "decoding"
  | "done"
  | "error";

export interface ImageItem {
  id: string;
  name: string;
  path: string;
  status: ImageStatus;
  error?: string;
  objectKey?: string;
  watermarkedKey?: string;
  watermarkedUrl?: string;
  decodedText?: string;
  preserveSource?: boolean;
}

interface Props {
  image: ImageItem;
  onProcess: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteOss?: (id: string) => void;
  onDownload?: (id: string) => void;
  onRename?: (id: string, newName: string) => void;
  processLabel?: string;
  processIcon?: React.ReactNode;
}

const statusConfig: Record<
  ImageStatus,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending: {
    label: "已上传",
    color: "text-zinc-500 bg-zinc-100 dark:bg-zinc-800",
    icon: null,
  },
  uploading: {
    label: "上传中",
    color: "text-blue-600 bg-blue-50 dark:bg-blue-900/30",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  },
  watermarking: {
    label: "加水印中",
    color: "text-amber-600 bg-amber-50 dark:bg-amber-900/30",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  },
  decoding: {
    label: "解析中",
    color: "text-purple-600 bg-purple-50 dark:bg-purple-900/30",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  },
  done: {
    label: "完成",
    color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  error: {
    label: "失败",
    color: "text-red-600 bg-red-50 dark:bg-red-900/30",
    icon: <XCircle className="h-3.5 w-3.5" />,
  },
};

function IconBtn({
  onClick,
  disabled,
  title,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg p-1.5 transition disabled:opacity-30 disabled:cursor-not-allowed ${className ?? "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"}`}
    >
      {children}
    </button>
  );
}

function Thumbnail({ src, busy }: { src?: string; busy: boolean }) {
  const [failed, setFailed] = useLocalState(false);

  if (busy && !src) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!src || failed) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-lg object-cover bg-zinc-100 dark:bg-zinc-800"
    />
  );
}

export default function ImageCard({
  image,
  onProcess,
  onRemove,
  onDeleteOss,
  onDownload,
  onRename,
  processLabel = "处理",
  processIcon,
}: Props) {
  const st = statusConfig[image.status];
  const busy = ["uploading", "watermarking", "decoding"].includes(
    image.status
  );

  const hasOssFile = !!(image.watermarkedKey || image.objectKey);

  const [copiedUrl, setCopiedUrl] = useLocalState(false);
  const [copiedImg, setCopiedImg] = useLocalState(false);
  const [editing, setEditing] = useLocalState(false);
  const [editName, setEditName] = useLocalState(image.name);

  async function handleCopyUrl() {
    if (image.watermarkedUrl) {
      await navigator.clipboard.writeText(image.watermarkedUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  }

  async function handleCopyImage() {
    if (!image.watermarkedUrl) return;
    try {
      const resp = await fetch(image.watermarkedUrl);
      const blob = await resp.blob();
      const pngBlob = blob.type === "image/png" ? blob : await toPng(blob);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pngBlob }),
      ]);
      setCopiedImg(true);
      setTimeout(() => setCopiedImg(false), 2000);
    } catch {
      // fallback: copy URL instead
      handleCopyUrl();
    }
  }

  async function toPng(blob: Blob): Promise<Blob> {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition hover:shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900">
      {/* Thumbnail */}
      <Thumbnail
        src={image.watermarkedUrl || (image.path && !image.path.startsWith("http") ? convertFileSrc(image.path) : image.path)}
        busy={busy}
      />

      {/* Info */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            className="w-full rounded border border-primary-400 bg-transparent px-1 py-0 text-sm font-medium text-zinc-800 outline-none dark:text-zinc-200"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => {
              setEditing(false);
              const trimmed = editName.trim();
              if (trimmed && trimmed !== image.name && onRename) {
                onRename(image.id, trimmed);
              } else {
                setEditName(image.name);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") { setEditName(image.name); setEditing(false); }
            }}
            autoFocus
          />
        ) : (
          <p
            className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200 cursor-default"
            onDoubleClick={() => { if (onRename) { setEditName(image.name); setEditing(true); } }}
            title="双击重命名"
          >
            {image.name}
          </p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.color}`}
          >
            {st.icon}
            {st.label}
          </span>
          {image.error && (
            <span className="truncate text-[11px] text-red-500 max-w-[200px]">
              {image.error}
            </span>
          )}
          {image.watermarkedUrl && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
              已加水印
            </span>
          )}
          {image.decodedText && (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
              水印: {image.decodedText}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
        {image.status === "pending" || image.status === "error" ? (
          <button
            onClick={() => onProcess(image.id)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-primary-700 disabled:opacity-40 transition"
          >
            {processIcon ?? <Stamp className="h-3.5 w-3.5" />}
            {processLabel}
          </button>
        ) : null}

        {image.watermarkedUrl && (
          <>
            <IconBtn onClick={handleCopyImage} title={copiedImg ? "已复制" : "复制图片到剪切板"}>
              {copiedImg ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </IconBtn>
            <IconBtn onClick={handleCopyUrl} title={copiedUrl ? "已复制" : "复制外链"}>
              {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Link className="h-3.5 w-3.5" />}
            </IconBtn>
          </>
        )}

        {onDownload && image.status === "done" && (
          <IconBtn onClick={() => onDownload(image.id)} title="下载">
            <Download className="h-3.5 w-3.5" />
          </IconBtn>
        )}

        {onDeleteOss && hasOssFile && (
          <IconBtn
            onClick={() => onDeleteOss(image.id)}
            disabled={busy}
            title="从 OSS 删除"
            className="text-orange-400 hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-900/20"
          >
            <CloudOff className="h-3.5 w-3.5" />
          </IconBtn>
        )}

        <IconBtn
          onClick={() => onRemove(image.id)}
          disabled={busy}
          title="从列表移除"
          className="text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>
    </div>
  );
}
