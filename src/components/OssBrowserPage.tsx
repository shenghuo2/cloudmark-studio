import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  ImageOff,
  Loader2,
  Pencil,
  RefreshCw,
  ScanSearch,
  Search,
  Stamp,
  Trash2,
} from "lucide-react";
import {
  deleteFromOss,
  listOssObjects,
  renameOssObject,
  type ListOssObjectsResult,
  type OssObjectEntry,
  type OssObjectRef,
} from "../lib/tauri";

interface Props {
  ossConfigured: boolean;
  onSendToWatermark: (items: OssObjectRef[]) => void;
  onSendToDecode: (items: OssObjectRef[]) => void;
  active?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function parentPrefix(prefix: string): string {
  const trimmed = prefix.replace(/\/$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split("/");
  parts.pop();
  return parts.length > 0 ? `${parts.join("/")}/` : "";
}

function mergePage(prev: ListOssObjectsResult, next: ListOssObjectsResult): ListOssObjectsResult {
  const prefixMap = new Map(prev.prefixes.map((item) => [item.prefix, item]));
  for (const item of next.prefixes) {
    prefixMap.set(item.prefix, item);
  }

  const objectMap = new Map(prev.objects.map((item) => [item.key, item]));
  for (const item of next.objects) {
    objectMap.set(item.key, item);
  }

  return {
    ...next,
    prefixes: Array.from(prefixMap.values()),
    objects: Array.from(objectMap.values()),
  };
}

function RemoteThumb({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className="h-11 w-11 shrink-0 rounded-xl bg-zinc-100 object-cover dark:bg-zinc-800"
    />
  );
}

export default function OssBrowserPage({
  ossConfigured,
  onSendToWatermark,
  onSendToDecode,
  active = true,
}: Props) {
  const [data, setData] = useState<ListOssObjectsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const currentPrefix = data?.prefix ?? "";

  const loadPrefix = useCallback(
    async (prefix: string, continuationToken?: string, append = false) => {
      if (!ossConfigured) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const result = await listOssObjects({
          prefix,
          continuationToken,
          delimiter: "/",
          maxKeys: 200,
        });
        setData((prev) =>
          append && prev ? mergePage(prev, result) : result
        );
        loadedRef.current = true;
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [ossConfigured]
  );

  useEffect(() => {
    if (ossConfigured && active && !loadedRef.current) {
      void loadPrefix("");
    }
  }, [active, loadPrefix, ossConfigured]);

  const breadcrumbs = useMemo(() => {
    const trimmed = currentPrefix.replace(/\/$/, "");
    if (!trimmed) return [] as { label: string; prefix: string }[];
    const parts = trimmed.split("/");
    let acc = "";
    return parts.map((part) => {
      acc += `${part}/`;
      return { label: part, prefix: acc };
    });
  }, [currentPrefix]);

  const keyword = filter.trim().toLowerCase();
  const visiblePrefixes = useMemo(
    () =>
      (data?.prefixes ?? []).filter((item) =>
        item.name.toLowerCase().includes(keyword)
      ),
    [data?.prefixes, keyword]
  );
  const visibleObjects = useMemo(
    () =>
      (data?.objects ?? []).filter((item) =>
        item.name.toLowerCase().includes(keyword)
      ),
    [data?.objects, keyword]
  );

  const handleRefresh = useCallback(() => {
    void loadPrefix(currentPrefix);
  }, [currentPrefix, loadPrefix]);

  const handleGoParent = useCallback(() => {
    void loadPrefix(parentPrefix(currentPrefix));
  }, [currentPrefix, loadPrefix]);

  const handleCopyUrl = useCallback(async (item: OssObjectEntry) => {
    await navigator.clipboard.writeText(item.url);
  }, []);

  const handleRename = useCallback(
    async (item: OssObjectEntry) => {
      const nextName = window.prompt("新的文件名", item.name)?.trim();
      if (!nextName || nextName === item.name) return;

      setBusyKey(item.key);
      try {
        const result = await renameOssObject(item.key, nextName);
        setData((prev) =>
          prev
            ? {
                ...prev,
                objects: prev.objects.map((obj) =>
                  obj.key === item.key
                    ? {
                        ...obj,
                        key: result.new_key,
                        name: nextName,
                        url: result.url,
                      }
                    : obj
                ),
              }
            : prev
        );
      } catch (e) {
        window.alert(`重命名失败: ${e}`);
      } finally {
        setBusyKey(null);
      }
    },
    []
  );

  const handleDelete = useCallback(async (item: OssObjectEntry) => {
    if (!window.confirm(`确认删除 OSS 文件 “${item.name}” 吗？`)) return;

    setBusyKey(item.key);
    try {
      await deleteFromOss(item.key);
      setData((prev) =>
        prev
          ? {
              ...prev,
              objects: prev.objects.filter((obj) => obj.key !== item.key),
            }
          : prev
      );
    } catch (e) {
      window.alert(`删除失败: ${e}`);
    } finally {
      setBusyKey(null);
    }
  }, []);

  const toRef = useCallback(
    (item: OssObjectEntry): OssObjectRef => ({
      objectKey: item.key,
      name: item.name,
      url: item.url,
    }),
    []
  );

  if (!ossConfigured) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
        请先在设置中配置 OSS 信息
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700/60 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleGoParent}
            disabled={loading || !currentPrefix}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            上一级
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="筛选当前目录文件"
              className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <button
            onClick={() => void loadPrefix("")}
            className={`rounded-md px-2 py-1 transition ${
              currentPrefix === ""
                ? "bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            根目录
          </button>
          {breadcrumbs.map((crumb) => (
            <div key={crumb.prefix} className="inline-flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-zinc-400" />
              <button
                onClick={() => void loadPrefix(crumb.prefix)}
                className={`rounded-md px-2 py-1 transition ${
                  currentPrefix === crumb.prefix
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {crumb.label}
              </button>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700/60 dark:bg-zinc-900">
        {loading && !data ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在读取 OSS 文件...
          </div>
        ) : (
          <div className="space-y-2">
            {visiblePrefixes.map((item) => (
              <button
                key={item.prefix}
                onClick={() => void loadPrefix(item.prefix)}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 text-left transition hover:border-primary-300 hover:bg-primary-50/40 dark:border-zinc-700 dark:hover:border-primary-800 dark:hover:bg-primary-900/10"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500 dark:bg-amber-900/20 dark:text-amber-400">
                  <Folder className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {item.name}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {item.prefix}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-400" />
              </button>
            ))}

            {visibleObjects.map((item) => {
              const busy = busyKey === item.key;
              return (
                <div
                  key={item.key}
                  className="group flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 transition hover:shadow-sm dark:border-zinc-700/60"
                >
                  <RemoteThumb url={item.url} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {item.name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span>{formatBytes(item.size)}</span>
                      {item.last_modified && <span>{formatTime(item.last_modified)}</span>}
                      <span className="truncate">{item.key}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => onSendToWatermark([toRef(item)])}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-primary-700 disabled:opacity-40"
                    >
                      <Stamp className="h-3.5 w-3.5" />
                      加水印
                    </button>
                    <button
                      onClick={() => onSendToDecode([toRef(item)])}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-purple-700 disabled:opacity-40"
                    >
                      <ScanSearch className="h-3.5 w-3.5" />
                      解析
                    </button>
                    <button
                      onClick={() => void handleCopyUrl(item)}
                      disabled={busy}
                      title="复制外链"
                      className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void handleRename(item)}
                      disabled={busy}
                      title="重命名"
                      className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => void handleDelete(item)}
                      disabled={busy}
                      title="删除"
                      className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-40 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}

            {data?.is_truncated && data.next_continuation_token && (
              <button
                onClick={() =>
                  void loadPrefix(currentPrefix, data.next_continuation_token ?? undefined, true)
                }
                disabled={loadingMore}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                {loadingMore ? "加载中..." : "加载更多"}
              </button>
            )}

            {!loading && visiblePrefixes.length === 0 && visibleObjects.length === 0 && (
              <div className="flex h-[240px] items-center justify-center text-sm text-zinc-400">
                当前目录暂无文件
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
