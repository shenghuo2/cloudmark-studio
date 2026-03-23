import { useState, useCallback, useRef, useEffect } from "react";
import { ScanSearch, Loader2, ImageOff } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import DropZone from "./DropZone";
import {
  uploadToOss,
  decodeWatermark,
  getDecodeResult,
  downloadUrlToTemp,
  deleteFromOss,
} from "../lib/tauri";
import type { OssObjectRef } from "../lib/tauri";
import { pushHistory } from "./HistoryPage";

interface DecodeItem {
  id: string;
  name: string;
  path: string;
  status: "pending" | "uploading" | "decoding" | "done" | "error";
  error?: string;
  result?: string;
  objectKey?: string;
  progress?: number;
  previewUrl?: string;
  preserveSource?: boolean;
}

let nextId = 0;

interface Props {
  ossConfigured: boolean;
  active?: boolean;
  autoDelete?: boolean;
  externalOssObjects?: OssObjectRef[];
}

function DecodeThumbnail({
  path,
  previewUrl,
  busy,
}: {
  path: string;
  previewUrl?: string;
  busy: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = previewUrl
    ? previewUrl
    : path.startsWith("http")
      ? path
      : convertFileSrc(path);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (busy && !path) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-900/20">
        <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-400 dark:bg-purple-900/20">
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-lg bg-purple-50 object-cover dark:bg-purple-900/20"
    />
  );
}

export default function DecodePage({
  ossConfigured,
  active = true,
  autoDelete = true,
  externalOssObjects,
}: Props) {
  const [items, setItems] = useState<DecodeItem[]>([]);
  const [strength, setStrength] = useState("low");

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const updateItem = useCallback((id: string, patch: Partial<DecodeItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const autoUpload = useCallback(
    async (id: string, localPath: string) => {
      updateItem(id, { status: "uploading", error: undefined });
      try {
        const upload = await uploadToOss(localPath);
        updateItem(id, {
          status: "pending",
          objectKey: upload.object_key,
          previewUrl: upload.url,
          preserveSource: false,
        });
      } catch (e) {
        updateItem(id, { status: "error", error: `上传失败: ${e}` });
      }
    },
    [updateItem]
  );

  const processedExternalOssRef = useRef<OssObjectRef[] | undefined>(undefined);
  useEffect(() => {
    if (
      externalOssObjects &&
      externalOssObjects.length > 0 &&
      externalOssObjects !== processedExternalOssRef.current
    ) {
      processedExternalOssRef.current = externalOssObjects;
      const newItems: DecodeItem[] = externalOssObjects.map((item) => ({
        id: String(++nextId),
        name: item.name,
        path: item.url,
        status: "pending" as const,
        objectKey: item.objectKey,
        previewUrl: item.url,
        preserveSource: true,
      }));
      setItems((prev) => [...prev, ...newItems]);
    }
  }, [externalOssObjects]);

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      const newItems: DecodeItem[] = paths.map((p) => ({
        id: String(++nextId),
        name: p.split("/").pop() ?? p.split("\\").pop() ?? p,
        path: p,
        status: "uploading" as const,
        preserveSource: false,
      }));
      setItems((prev) => [...prev, ...newItems]);
      for (const item of newItems) {
        autoUpload(item.id, item.path);
      }
    },
    [autoUpload]
  );

  const handleUrlSubmit = useCallback(
    (url: string) => {
      const name = url.split("/").pop()?.split("?")[0] || "url-image";
      const id = String(++nextId);
      setItems((prev) => [
        ...prev,
        { id, name, path: url, status: "uploading" as const, preserveSource: false },
      ]);
      (async () => {
        try {
          const tempPath = await downloadUrlToTemp(url);
          const upload = await uploadToOss(tempPath);
          updateItem(id, {
            status: "pending",
            path: tempPath,
            objectKey: upload.object_key,
            previewUrl: upload.url,
            preserveSource: false,
          });
        } catch (e) {
          updateItem(id, { status: "error", error: `获取失败: ${e}` });
        }
      })();
    },
    [updateItem]
  );

  const handleDecode = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;

      const objectKey = item.objectKey;
      if (!objectKey) {
        updateItem(id, { status: "error", error: "图片尚未上传完成" });
        return;
      }

      updateItem(id, { status: "decoding", error: undefined });
      try {
        const submit = await decodeWatermark(objectKey, strength);
        const maxPolls = 30;
        for (let i = 0; i < maxPolls; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          updateItem(id, { progress: Math.round(((i + 1) / maxPolls) * 100) });
          const result = await getDecodeResult(submit.task_id);
          if (result.status === "Succeeded") {
            const content = result.content ?? "(无水印内容)";
            updateItem(id, {
              status: "done",
              result: content,
            });
            pushHistory({
              type: "decode",
              name: item.name,
              url: item.path.startsWith("http") ? item.path : "",
              decodedText: content,
              objectKey,
            });
            if (autoDelete && objectKey && !item.preserveSource) {
              try {
                await deleteFromOss(objectKey);
              } catch {
                // ignore cleanup failures for temp uploads
              }
              updateItem(id, { objectKey: undefined });
            }
            return;
          }
          if (result.status === "Failed") {
            updateItem(id, {
              status: "error",
              error: result.message ?? "解码失败",
            });
            return;
          }
        }
        updateItem(id, { status: "error", error: "解码超时（60s）" });
      } catch (e) {
        updateItem(id, { status: "error", error: String(e) });
      }
    },
    [autoDelete, strength, updateItem]
  );

  const handleRemove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const statusColors: Record<string, string> = {
    pending: "text-zinc-500 bg-zinc-100 dark:bg-zinc-800",
    uploading: "text-blue-600 bg-blue-50 dark:bg-blue-900/30",
    decoding: "text-purple-600 bg-purple-50 dark:bg-purple-900/30",
    done: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30",
    error: "text-red-600 bg-red-50 dark:bg-red-900/30",
  };

  const statusLabels: Record<string, string> = {
    pending: "已上传",
    uploading: "上传中",
    decoding: "解析中",
    done: "完成",
    error: "失败",
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700/60 dark:bg-zinc-900">
        <div className="w-32">
          <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            解码强度
          </label>
          <select
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </div>
        <p className="pb-1 text-xs text-zinc-400">
          强度需要与加水印时的强度一致
        </p>
      </div>

      <DropZone
        onFilesSelected={handleFilesSelected}
        onUrlSubmit={handleUrlSubmit}
        disabled={!ossConfigured}
        compact={items.length > 0}
        active={active}
      />
      {!ossConfigured && (
        <p className="text-center text-xs text-amber-600 dark:text-amber-400">
          请先在设置中配置 OSS 信息
        </p>
      )}

      {items.length > 0 && (
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {items.map((item) => {
            const busy = item.status === "uploading" || item.status === "decoding";
            return (
              <div
                key={item.id}
                className="group flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition hover:shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900"
              >
                <DecodeThumbnail path={item.path} previewUrl={item.previewUrl} busy={busy} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {item.name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColors[item.status]}`}
                    >
                      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                      {statusLabels[item.status]}
                    </span>
                    {item.error && (
                      <span className="max-w-[300px] truncate text-[11px] text-red-500">
                        {item.error}
                      </span>
                    )}
                    {item.result && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        {item.result}
                      </span>
                    )}
                  </div>
                  {item.status === "decoding" && item.progress != null && (
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                      <div
                        className="h-full rounded-full bg-purple-500 transition-all duration-500 ease-out"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                  {(item.status === "pending" || item.status === "error") && (
                    <button
                      onClick={() => handleDecode(item.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-purple-700 disabled:opacity-40"
                    >
                      <ScanSearch className="h-3.5 w-3.5" />
                      解析水印
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(item.id)}
                    disabled={busy}
                    className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:hover:bg-red-900/20"
                    title="移除"
                  >
                    <span className="text-xs">✕</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {items.length === 0 && ossConfigured && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
          上传本地图片，或从 OSS 文件页发送对象进行解析
        </div>
      )}
    </div>
  );
}
