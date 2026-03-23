import { useState, useCallback, useRef, useEffect } from "react";
import {
  Loader2,
  Download,
  Trash2,
  ArrowRight,
  Stamp,
  Copy,
  Check,
  ImageOff,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import DropZone from "./DropZone";
import { getImageInfo, compressImage, getTempDir, downloadUrlToTemp } from "../lib/tauri";
import type { ImageInfo, CompressResult } from "../lib/tauri";

type OutputFormat = "original" | "jpeg" | "png" | "webp";

interface CompressItem {
  id: string;
  name: string;
  path: string;
  info: ImageInfo | null;
  status: "loading" | "ready" | "compressing" | "done" | "error";
  error?: string;
  result?: CompressResult;
}

let nextId = 0;

interface Props {
  autoSave?: boolean;
  onSendToWatermark?: (paths: string[]) => void;
  active?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function ratio(original: number, compressed: number): string {
  if (original === 0) return "—";
  const delta = ((compressed - original) / original) * 100;
  if (Math.abs(delta) < 0.05) return "0.0%";
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)}%`;
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

const FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: "original", label: "保持原格式" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
];

function CompressThumbnail({ path, busy }: { path: string; busy: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = path.startsWith("http") ? path : convertFileSrc(path);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (busy && !path) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (failed) {
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

export default function ToolsPage({ autoSave = false, onSendToWatermark, active = true }: Props) {
  const [items, setItems] = useState<CompressItem[]>([]);
  const [format, setFormat] = useState<OutputFormat>("original");
  const [quality, setQuality] = useState(80);
  const [pngLevel, setPngLevel] = useState(2);
  const [resizeW, setResizeW] = useState<string>("");
  const [resizeH, setResizeH] = useState<string>("");

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const loadItems = useCallback(async (entries: Array<{ id: string; path: string }>) => {
    for (const entry of entries) {
      try {
        const info = await getImageInfo(entry.path);
        setItems((prev) =>
          prev.map((i) =>
            i.id === entry.id ? { ...i, info, status: "ready" } : i
          )
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === entry.id
              ? { ...i, status: "error", error: String(e) }
              : i
          )
        );
      }
    }
  }, []);

  const handleFilesSelected = useCallback(async (paths: string[]) => {
    const newItems: CompressItem[] = paths.map((p) => ({
      id: String(++nextId),
      name: p.split("/").pop() ?? p.split("\\").pop() ?? p,
      path: p,
      info: null,
      status: "loading" as const,
    }));
    setItems((prev) => [...prev, ...newItems]);
    await loadItems(newItems.map((item) => ({ id: item.id, path: item.path })));
  }, [loadItems]);

  const handleUrlSubmit = useCallback((url: string) => {
    const name = url.split("/").pop()?.split("?")[0] || "url-image";
    const id = String(++nextId);
    setItems((prev) => [
      ...prev,
      {
        id,
        name,
        path: url,
        info: null,
        status: "loading" as const,
      },
    ]);

    (async () => {
      try {
        const tempPath = await downloadUrlToTemp(url);
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, path: tempPath } : item
          )
        );
        await loadItems([{ id, path: tempPath }]);
      } catch (e) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: "error", error: "获取失败: " + String(e) }
              : item
          )
        );
      }
    })();
  }, [loadItems]);

  const handleCompress = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;

      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, status: "compressing", error: undefined } : i
        )
      );

      try {
        const outputDir = autoSave ? undefined : await getTempDir();
        const result = await compressImage(item.path, {
          format,
          quality,
          pngLevel: format === "png" ? pngLevel : undefined,
          width: resizeW ? parseInt(resizeW) : undefined,
          height: resizeH ? parseInt(resizeH) : undefined,
          outputDir,
        });
        setItems((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, status: "done", result } : i
          )
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, status: "error", error: String(e) } : i
          )
        );
      }
    },
    [format, quality, pngLevel, resizeW, resizeH, autoSave]
  );

  const handleCompressAll = useCallback(async () => {
    const toProcess = itemsRef.current.filter(
      (i) => i.status === "ready" || i.status === "error"
    );
    for (const item of toProcess) {
      await handleCompress(item.id);
    }
  }, [handleCompress]);

  const handleRemove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyToClipboard = useCallback(async (item: CompressItem) => {
    if (!item.result) return;
    try {
      const resp = await fetch(convertFileSrc(item.result.output_path));
      const blob = await resp.blob();
      const pngBlob = blob.type === "image/png" ? blob : await toPng(blob);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pngBlob }),
      ]);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // fallback: do nothing
    }
  }, []);

  const handleSendToWatermark = useCallback(
    (item: CompressItem) => {
      if (!item.result || !onSendToWatermark) return;
      onSendToWatermark([item.result.output_path]);
    },
    [onSendToWatermark]
  );

  const readyCount = items.filter(
    (i) => i.status === "ready" || i.status === "error"
  ).length;
  const showLossy = format === "jpeg" || format === "webp" || format === "original";
  const showPng = format === "png";

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Compression settings bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700/60 dark:bg-zinc-900">
        {/* Format */}
        <div className="w-36">
          <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            输出格式
          </label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as OutputFormat)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Quality slider (lossy) */}
        {showLossy && (
          <div className="w-48">
            <label className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
              <span>质量</span>
              <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                {quality}
              </span>
            </label>
            <input
              type="range"
              min={1}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full accent-primary-600"
            />
            <div className="flex justify-between text-[10px] text-zinc-400">
              <span>小文件</span>
              <span>高质量</span>
            </div>
          </div>
        )}

        {/* PNG level */}
        {showPng && (
          <div className="w-36">
            <label className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
              <span>PNG 优化</span>
              <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                {pngLevel}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={6}
              value={pngLevel}
              onChange={(e) => setPngLevel(Number(e.target.value))}
              className="w-full accent-primary-600"
            />
            <div className="flex justify-between text-[10px] text-zinc-400">
              <span>快速</span>
              <span>极致</span>
            </div>
          </div>
        )}

        {/* Resize */}
        <div className="flex items-end gap-1.5">
          <div className="w-20">
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              宽度
            </label>
            <input
              type="number"
              min={0}
              value={resizeW}
              onChange={(e) => setResizeW(e.target.value)}
              placeholder="自动"
              className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <span className="pb-2 text-xs text-zinc-400">×</span>
          <div className="w-20">
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              高度
            </label>
            <input
              type="number"
              min={0}
              value={resizeH}
              onChange={(e) => setResizeH(e.target.value)}
              placeholder="自动"
              className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* Batch compress button */}
        {readyCount > 0 && (
          <button
            onClick={handleCompressAll}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700"
          >
            <Download className="h-4 w-4" />
            全部压缩 ({readyCount})
          </button>
        )}
      </div>

      {/* Drop zone */}
      <DropZone
        onFilesSelected={handleFilesSelected}
        onUrlSubmit={handleUrlSubmit}
        compact={items.length > 0}
        active={active}
      />

      {/* File list */}
      {items.length > 0 && (
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {items.map((item) => {
            const busy =
              item.status === "loading" || item.status === "compressing";
            return (
              <div
                key={item.id}
                className="group flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition hover:shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900"
              >
                {/* Thumbnail */}
                <CompressThumbnail path={item.path} busy={busy} />

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {item.name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
                    {item.info && (
                      <>
                        <span className="text-zinc-500">
                          {item.info.width}×{item.info.height}
                        </span>
                        <span className="text-zinc-400">
                          {item.info.format.toUpperCase()}
                        </span>
                        <span className="text-zinc-500">
                          {formatBytes(item.info.file_size)}
                        </span>
                      </>
                    )}
                    {item.status === "error" && item.error && (
                      <span className="text-red-500 truncate max-w-[250px]">
                        {item.error}
                      </span>
                    )}
                    {item.result && (
                      <>
                        <ArrowRight className="h-3 w-3 text-zinc-400" />
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {formatBytes(item.result.compressed_size)}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 font-semibold ${
                            item.result.compressed_size <
                            (item.info?.file_size ?? Infinity)
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          }`}
                        >
                          {ratio(
                            item.info?.file_size ?? 0,
                            item.result.compressed_size
                          )}
                        </span>
                        {item.result.width !== item.info?.width && (
                          <span className="text-zinc-400">
                            → {item.result.width}×{item.result.height}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
                  {(item.status === "ready" || item.status === "error") && (
                    <button
                      onClick={() => handleCompress(item.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-primary-700 disabled:opacity-40 transition"
                    >
                      <Download className="h-3.5 w-3.5" />
                      压缩
                    </button>
                  )}

                  {item.result && (
                    <>
                      <button
                        onClick={() => handleCopyToClipboard(item)}
                        title={copiedId === item.id ? "已复制" : "复制到剪切板"}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition dark:hover:bg-zinc-700"
                      >
                        {copiedId === item.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {onSendToWatermark && (
                        <button
                          onClick={() => handleSendToWatermark(item)}
                          title="发送到添加水印"
                          className="rounded-lg p-1.5 text-zinc-400 hover:bg-primary-50 hover:text-primary-600 transition dark:hover:bg-primary-900/20"
                        >
                          <Stamp className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => handleRemove(item.id)}
                    disabled={busy}
                    title="移除"
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition disabled:opacity-30 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-zinc-400">
          <p className="text-sm">选择图片开始压缩</p>
          <p className="text-xs">
            支持 JPEG、PNG、WebP、AVIF 格式 · 可批量处理
          </p>
        </div>
      )}
    </div>
  );
}
