import { useState, useEffect, useCallback } from "react";
import {
  Trash2,
  Copy,
  Link,
  Check,
  Clock,
  Stamp,
  ScanSearch,
} from "lucide-react";
import { copyImageToClipboard } from "../lib/tauri";

export interface HistoryRecord {
  id: string;
  type: "watermark" | "decode";
  name: string;
  url: string;
  watermarkText?: string;
  decodedText?: string;
  objectKey?: string;
  timestamp: number;
}

const STORAGE_KEY = "cloudmark-history";

function loadHistory(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: HistoryRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/** Add a record to history (called from other pages). */
export function pushHistory(record: Omit<HistoryRecord, "id" | "timestamp">) {
  const records = loadHistory();
  const entry: HistoryRecord = {
    ...record,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  records.unshift(entry);
  // Keep max 200 records
  if (records.length > 200) records.length = 200;
  saveHistory(records);
  window.dispatchEvent(new CustomEvent("history-updated"));
}

function IconBtn({
  onClick,
  title,
  className,
  children,
}: {
  onClick: () => void;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-lg p-1.5 transition ${className ?? "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"}`}
    >
      {children}
    </button>
  );
}

export default function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>(loadHistory);

  // Listen for updates from other pages
  useEffect(() => {
    const handler = () => setRecords(loadHistory());
    window.addEventListener("history-updated", handler);
    return () => window.removeEventListener("history-updated", handler);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setRecords((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveHistory(next);
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    saveHistory([]);
    setRecords([]);
  }, []);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header bar */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700/60 dark:bg-zinc-900">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          共 {records.length} 条记录
        </span>
        {records.length > 0 && (
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50 transition dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清空历史
          </button>
        )}
      </div>

      {/* List */}
      {records.length > 0 ? (
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {records.map((rec) => (
            <HistoryItem
              key={rec.id}
              record={rec}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
          暂无历史记录
        </div>
      )}
    </div>
  );
}

function HistoryItem({
  record,
  onDelete,
}: {
  record: HistoryRecord;
  onDelete: (id: string) => void;
}) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedImg, setCopiedImg] = useState(false);
  const [copyImgFailed, setCopyImgFailed] = useState(false);

  async function handleCopyUrl() {
    await navigator.clipboard.writeText(record.url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  async function handleCopyImage() {
    try {
      await copyImageToClipboard(record.url);
      setCopiedImg(true);
      setCopyImgFailed(false);
      setTimeout(() => setCopiedImg(false), 2000);
    } catch (error) {
      console.error("copy image failed", error);
      setCopyImgFailed(true);
      setTimeout(() => setCopyImgFailed(false), 2000);
    }
  }

  const time = new Date(record.timestamp);
  const timeStr = `${time.getMonth() + 1}/${time.getDate()} ${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}`;

  const isWatermark = record.type === "watermark";

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition hover:shadow-sm dark:border-zinc-700/60 dark:bg-zinc-900">
      {/* Icon */}
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          isWatermark
            ? "bg-primary-50 text-primary-500 dark:bg-primary-900/20"
            : "bg-purple-50 text-purple-500 dark:bg-purple-900/20"
        }`}
      >
        {isWatermark ? <Stamp className="h-5 w-5" /> : <ScanSearch className="h-5 w-5" />}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {record.name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              isWatermark
                ? "text-primary-600 bg-primary-50 dark:bg-primary-900/30"
                : "text-purple-600 bg-purple-50 dark:bg-purple-900/30"
            }`}
          >
            {isWatermark ? "加水印" : "解码"}
          </span>
          {record.watermarkText && (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              水印: {record.watermarkText}
            </span>
          )}
          {record.decodedText && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              {record.decodedText}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5 text-[11px] text-zinc-400">
            <Clock className="h-3 w-3" />
            {timeStr}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
        {record.url && (
          <>
            <IconBtn onClick={handleCopyImage} title={copyImgFailed ? "复制失败" : copiedImg ? "已复制" : "复制图片到剪切板"}>
              {copiedImg ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </IconBtn>
            <IconBtn onClick={handleCopyUrl} title={copiedUrl ? "已复制" : "复制外链"}>
              {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Link className="h-3.5 w-3.5" />}
            </IconBtn>
          </>
        )}
        <IconBtn
          onClick={() => onDelete(record.id)}
          title="删除记录"
          className="text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>
    </div>
  );
}
