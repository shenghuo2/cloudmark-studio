import { useState, useCallback, useRef } from "react";
import { Stamp, Zap } from "lucide-react";
import DropZone from "./DropZone";
import ImageCard from "./ImageCard";
import type { ImageItem } from "./ImageCard";
import { addWatermark, deleteFromOss } from "../lib/tauri";

let nextId = 0;

interface Props {
  ossConfigured: boolean;
}

export default function WatermarkPage({ ossConfigured }: Props) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [watermarkText, setWatermarkText] = useState("版权所有CloudMark");
  const [strength, setStrength] = useState("low");

  const imagesRef = useRef(images);
  imagesRef.current = images;

  const updateImage = useCallback(
    (id: string, patch: Partial<ImageItem>) => {
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, ...patch } : img))
      );
    },
    []
  );

  const handleFilesSelected = useCallback((paths: string[]) => {
    const newImages: ImageItem[] = paths.map((p) => ({
      id: String(++nextId),
      name: p.split("/").pop() ?? p.split("\\").pop() ?? p,
      path: p,
      status: "pending" as const,
    }));
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const handleUrlSubmit = useCallback((url: string) => {
    const name = url.split("/").pop()?.split("?")[0] || "url-image";
    setImages((prev) => [
      ...prev,
      {
        id: String(++nextId),
        name,
        path: url,
        status: "pending" as const,
      },
    ]);
  }, []);

  const handleAddWatermark = useCallback(
    async (id: string) => {
      const img = imagesRef.current.find((i) => i.id === id);
      if (!img) return;

      if (!watermarkText.trim()) {
        updateImage(id, { status: "error", error: "请输入水印文本" });
        return;
      }

      updateImage(id, { status: "watermarking", error: undefined });
      try {
        const result = await addWatermark(img.path, {
          watermarkText: watermarkText.trim(),
          strength,
        });
        updateImage(id, {
          status: "done",
          objectKey: result.source_key,
          watermarkedKey: result.output_key,
          watermarkedUrl: result.url,
        });
      } catch (e) {
        updateImage(id, { status: "error", error: String(e) });
      }
    },
    [updateImage, watermarkText, strength]
  );

  const handleDeleteOss = useCallback(
    async (id: string) => {
      const img = imagesRef.current.find((i) => i.id === id);
      if (!img) return;
      try {
        if (img.watermarkedKey) await deleteFromOss(img.watermarkedKey);
        if (img.objectKey) await deleteFromOss(img.objectKey);
        updateImage(id, {
          watermarkedKey: undefined,
          watermarkedUrl: undefined,
          objectKey: undefined,
          status: "pending",
        });
      } catch (e) {
        updateImage(id, { error: `删除失败: ${e}` });
      }
    },
    [updateImage]
  );

  const handleRemove = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  async function handleBatchWatermark() {
    const pending = imagesRef.current.filter(
      (img) => img.status === "pending" || img.status === "error"
    );
    for (const img of pending) {
      await handleAddWatermark(img.id);
    }
  }

  const pendingCount = images.filter(
    (i) => i.status === "pending" || i.status === "error"
  ).length;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Watermark settings bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700/60 dark:bg-zinc-900">
        <div className="flex-1 min-w-[200px]">
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
        {images.length > 0 && pendingCount > 0 && (
          <button
            onClick={handleBatchWatermark}
            disabled={!ossConfigured || !watermarkText.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap className="h-4 w-4" />
            全部加水印 ({pendingCount})
          </button>
        )}
      </div>

      {/* Drop zone */}
      <DropZone
        onFilesSelected={handleFilesSelected}
        onUrlSubmit={handleUrlSubmit}
        disabled={!ossConfigured}
        compact={images.length > 0}
      />
      {!ossConfigured && (
        <p className="text-center text-xs text-amber-600 dark:text-amber-400">
          请先在设置中配置 OSS 信息
        </p>
      )}

      {/* Image list */}
      {images.length > 0 && (
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {images.map((img) => (
            <ImageCard
              key={img.id}
              image={img}
              onProcess={handleAddWatermark}
              onRemove={handleRemove}
              onDeleteOss={handleDeleteOss}
              processLabel="加水印"
              processIcon={<Stamp className="h-3.5 w-3.5" />}
            />
          ))}
        </div>
      )}

      {images.length === 0 && ossConfigured && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
          拖拽或选择图片开始添加水印
        </div>
      )}
    </div>
  );
}
