import { useState, useCallback, useRef } from "react";
import { ScanSearch, Loader2 } from "lucide-react";
import DropZone from "./DropZone";
import { uploadToOss, decodeWatermark, getDecodeResult, downloadUrlToTemp } from "../lib/tauri";
import { pushHistory } from "./HistoryPage";

interface DecodeItem {
  id: string;
  name: string;
  path: string;
  status: "pending" | "uploading" | "decoding" | "done" | "error";
  error?: string;
  result?: string;
  objectKey?: string;
}

let nextId = 0;

interface Props {
  ossConfigured: boolean;
}

export default function DecodePage({ ossConfigured }: Props) {
  const [items, setItems] = useState<DecodeItem[]>([]);
  const [strength, setStrength] = useState("low");

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const updateItem = useCallback(
    (id: string, patch: Partial<DecodeItem>) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
      );
    },
    []
  );

  // Auto-upload a single item to OSS
  const autoUpload = useCallback(
    async (id: string, localPath: string) => {
      updateItem(id, { status: "uploading", error: undefined });
      try {
        const upload = await uploadToOss(localPath);
        updateItem(id, { status: "pending", objectKey: upload.object_key });
      } catch (e) {
        updateItem(id, { status: "error", error: `上传失败: ${e}` });
      }
    },
    [updateItem]
  );

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      const newItems: DecodeItem[] = paths.map((p) => ({
        id: String(++nextId),
        name: p.split("/").pop() ?? p.split("\\").pop() ?? p,
        path: p,
        status: "uploading" as const,
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
        { id, name, path: url, status: "uploading" as const },
      ]);
      (async () => {
        try {
          const tempPath = await downloadUrlToTemp(url);
          const upload = await uploadToOss(tempPath);
          updateItem(id, { status: "pending", path: tempPath, objectKey: upload.object_key });
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

        // Poll for result (max 60s)
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
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
              url: "", // decode doesn't produce a URL
              decodedText: content,
              objectKey: objectKey,
            });
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
    [updateItem, strength]
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
      {/* Settings bar */}
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
        <p className="text-xs text-zinc-400 pb-1">
          强度需要与加水印时的强度一致
        </p>
      </div>

      {/* Drop zone */}
      <DropZone
        onFilesSelected={handleFilesSelected}
        onUrlSubmit={handleUrlSubmit}
        disabled={!ossConfigured}
        compact={items.length > 0}
      />
      {!ossConfigured && (
        <p className="text-center text-xs text-amber-600 dark:text-amber-400">
          请先在设置中配置 OSS 信息
        </p>
      )}

      {/* Results */}
      {items.length > 0 && (
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {items.map((item) => {
            const busy = item.status === "uploading" || item.status === "decoding";
            return (
              <div
                key={item.id}
                className="group flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition hover:shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-400 dark:bg-purple-900/20">
                  <ScanSearch className="h-5 w-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {item.name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColors[item.status]}`}
                    >
                      {busy && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {statusLabels[item.status]}
                    </span>
                    {item.error && (
                      <span className="truncate text-[11px] text-red-500 max-w-[300px]">
                        {item.error}
                      </span>
                    )}
                    {item.result && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        {item.result}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                  {(item.status === "pending" || item.status === "error") && (
                    <button
                      onClick={() => handleDecode(item.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-purple-700 disabled:opacity-40 transition"
                    >
                      <ScanSearch className="h-3.5 w-3.5" />
                      解析水印
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(item.id)}
                    disabled={busy}
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition disabled:opacity-30 dark:hover:bg-red-900/20"
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
          上传含有盲水印的图片进行解析
        </div>
      )}
    </div>
  );
}
