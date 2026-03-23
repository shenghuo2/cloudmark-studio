import { useState, useCallback, useRef, useEffect } from "react";
import { Stamp, Zap } from "lucide-react";
import DropZone from "./DropZone";
import ImageCard from "./ImageCard";
import type { ImageItem } from "./ImageCard";
import {
  addWatermark,
  deleteFromOss,
  downloadUrlToTemp,
  uploadToOss,
  renameOssObject,
} from "../lib/tauri";
import type { OssObjectRef, WatermarkConfig } from "../lib/tauri";
import { pushHistory } from "./HistoryPage";

let nextId = 0;

interface Props {
  ossConfigured: boolean;
  watermarkConfig: WatermarkConfig | null;
  externalFiles?: string[];
  externalOssObjects?: OssObjectRef[];
  active?: boolean;
}

export default function WatermarkPage({
  ossConfigured,
  watermarkConfig,
  externalFiles,
  externalOssObjects,
  active = true,
}: Props) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [watermarkText, setWatermarkText] = useState(
    watermarkConfig?.content || "版权所有CloudMark"
  );
  const [strength, setStrength] = useState(
    watermarkConfig?.strength || "low"
  );
  const [initialized, setInitialized] = useState(false);

  if (!initialized && watermarkConfig) {
    if (watermarkConfig.content) setWatermarkText(watermarkConfig.content);
    if (watermarkConfig.strength) setStrength(watermarkConfig.strength);
    setInitialized(true);
  }

  const imagesRef = useRef(images);
  imagesRef.current = images;

  const updateImage = useCallback((id: string, patch: Partial<ImageItem>) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, ...patch } : img))
    );
  }, []);

  const autoUpload = useCallback(
    async (id: string, localPath: string) => {
      updateImage(id, { status: "uploading", error: undefined });
      try {
        const result = await uploadToOss(localPath);
        updateImage(id, {
          status: "pending",
          objectKey: result.object_key,
          watermarkedUrl: undefined,
          previewUrl: result.url,
          preserveSource: false,
        });
      } catch (e) {
        updateImage(id, { status: "error", error: `上传失败: ${e}` });
      }
    },
    [updateImage]
  );

  const processedExternalRef = useRef<string[] | undefined>(undefined);
  useEffect(() => {
    if (
      externalFiles &&
      externalFiles.length > 0 &&
      externalFiles !== processedExternalRef.current
    ) {
      processedExternalRef.current = externalFiles;
      const newImages: ImageItem[] = externalFiles.map((p) => ({
        id: String(++nextId),
        name: p.split("/").pop() ?? p.split("\\").pop() ?? p,
        path: p,
        status: "uploading" as const,
        preserveSource: false,
      }));
      setImages((prev) => [...prev, ...newImages]);
      for (const img of newImages) {
        autoUpload(img.id, img.path);
      }
    }
  }, [externalFiles, autoUpload]);

  const processedExternalOssRef = useRef<OssObjectRef[] | undefined>(undefined);
  useEffect(() => {
    if (
      externalOssObjects &&
      externalOssObjects.length > 0 &&
      externalOssObjects !== processedExternalOssRef.current
    ) {
      processedExternalOssRef.current = externalOssObjects;
      const newImages: ImageItem[] = externalOssObjects.map((item) => ({
        id: String(++nextId),
        name: item.name,
        path: item.url,
        status: "pending" as const,
        objectKey: item.objectKey,
        previewUrl: item.url,
        preserveSource: true,
      }));
      setImages((prev) => [...prev, ...newImages]);
    }
  }, [externalOssObjects]);

  const handleFilesSelected = useCallback(
    (paths: string[]) => {
      const newImages: ImageItem[] = paths.map((p) => ({
        id: String(++nextId),
        name: p.split("/").pop() ?? p.split("\\").pop() ?? p,
        path: p,
        status: "uploading" as const,
        preserveSource: false,
      }));
      setImages((prev) => [...prev, ...newImages]);
      for (const img of newImages) {
        autoUpload(img.id, img.path);
      }
    },
    [autoUpload]
  );

  const handleUrlSubmit = useCallback(
    (url: string) => {
      const name = url.split("/").pop()?.split("?")[0] || "url-image";
      const id = String(++nextId);
      setImages((prev) => [
        ...prev,
        { id, name, path: url, status: "uploading" as const, preserveSource: false },
      ]);
      (async () => {
        try {
          updateImage(id, { status: "uploading", error: undefined });
          const tempPath = await downloadUrlToTemp(url);
          const result = await uploadToOss(tempPath);
          updateImage(id, {
            status: "pending",
            path: tempPath,
            objectKey: result.object_key,
            previewUrl: result.url,
            preserveSource: false,
          });
        } catch (e) {
          updateImage(id, { status: "error", error: `获取失败: ${e}` });
        }
      })();
    },
    [updateImage]
  );

  const handleAddWatermark = useCallback(
    async (id: string) => {
      const img = imagesRef.current.find((i) => i.id === id);
      if (!img) return;

      if (!watermarkText.trim()) {
        updateImage(id, { status: "error", error: "请输入水印文本" });
        return;
      }

      if (!img.objectKey) {
        updateImage(id, { status: "error", error: "图片尚未上传完成" });
        return;
      }

      updateImage(id, { status: "watermarking", error: undefined });
      try {
        const result = await addWatermark({
          objectKey: img.objectKey,
          sourceName: img.name,
          watermarkText: watermarkText.trim(),
          strength,
        });
        updateImage(id, {
          status: "done",
          objectKey: result.source_key,
          watermarkedKey: result.output_key,
          watermarkedUrl: result.url,
        });
        pushHistory({
          type: "watermark",
          name: img.name,
          url: result.url,
          watermarkText: watermarkText.trim(),
          objectKey: result.output_key,
        });
      } catch (e) {
        updateImage(id, { status: "error", error: String(e) });
      }
    },
    [strength, updateImage, watermarkText]
  );

  const handleDeleteOss = useCallback(
    async (id: string) => {
      const img = imagesRef.current.find((i) => i.id === id);
      if (!img) return;
      try {
        if (img.watermarkedKey) await deleteFromOss(img.watermarkedKey);
        if (img.objectKey && !img.preserveSource) await deleteFromOss(img.objectKey);
        setImages((prev) => prev.filter((item) => item.id !== id));
      } catch (e) {
        updateImage(id, { error: `删除失败: ${e}` });
      }
    },
    [updateImage]
  );

  const handleRemove = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleRename = useCallback(
    async (id: string, newName: string) => {
      const img = imagesRef.current.find((i) => i.id === id);
      if (!img?.objectKey) {
        setImages((prev) =>
          prev.map((i) => (i.id === id ? { ...i, name: newName } : i))
        );
        return;
      }
      try {
        const result = await renameOssObject(img.objectKey, newName);
        setImages((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  name: newName,
                  objectKey: result.new_key,
                  path: i.path.startsWith("http") ? result.url : i.path,
                }
              : i
          )
        );
      } catch (e) {
        updateImage(id, { error: `重命名失败: ${e}` });
      }
    },
    [updateImage]
  );

  async function handleBatchWatermark() {
    const ready = imagesRef.current.filter(
      (img) =>
        (img.status === "pending" || img.status === "error") && img.objectKey
    );
    for (const img of ready) {
      await handleAddWatermark(img.id);
    }
  }

  const readyCount = images.filter(
    (i) => (i.status === "pending" || i.status === "error") && i.objectKey
  ).length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700/60 dark:bg-zinc-900">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            水印文本
          </label>
          <input
            value={watermarkText}
            onChange={(e) => setWatermarkText(e.target.value)}
            placeholder="输入水印文本"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div className="w-32">
          <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            强度
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
        {images.length > 0 && readyCount > 0 && (
          <button
            onClick={handleBatchWatermark}
            disabled={!ossConfigured || !watermarkText.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Zap className="h-4 w-4" />
            全部加水印 ({readyCount})
          </button>
        )}
      </div>

      <DropZone
        onFilesSelected={handleFilesSelected}
        onUrlSubmit={handleUrlSubmit}
        disabled={!ossConfigured}
        compact={images.length > 0}
        active={active}
      />
      {!ossConfigured && (
        <p className="text-center text-xs text-amber-600 dark:text-amber-400">
          请先在设置中配置 OSS 信息
        </p>
      )}

      {images.length > 0 && (
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {images.map((img) => (
            <ImageCard
              key={img.id}
              image={img}
              onProcess={handleAddWatermark}
              onRemove={handleRemove}
              onDeleteOss={handleDeleteOss}
              onRename={handleRename}
              processLabel="加水印"
              processIcon={<Stamp className="h-3.5 w-3.5" />}
            />
          ))}
        </div>
      )}

      {images.length === 0 && ossConfigured && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
          拖拽、选择本地图片，或从 OSS 文件页发送对象开始添加水印
        </div>
      )}
    </div>
  );
}
