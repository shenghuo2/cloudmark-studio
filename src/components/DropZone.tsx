import { useState, useEffect, useRef, useCallback } from "react";
import { Upload, ImagePlus, Link } from "lucide-react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { savePastedImageToTemp } from "../lib/tauri";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "tiff", "avif"];

function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

interface Props {
  onFilesSelected: (paths: string[]) => void;
  onUrlSubmit?: (url: string) => void;
  disabled?: boolean;
  compact?: boolean;
  active?: boolean;
}

export default function DropZone({
  onFilesSelected,
  onUrlSubmit,
  disabled,
  compact,
  active = true,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const callbackRef = useRef(onFilesSelected);
  callbackRef.current = onFilesSelected;
  const processedRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (disabled || !activeRef.current) return;
        if (event.payload.type === "over") {
          setDragging(true);
        } else if (event.payload.type === "drop") {
          setDragging(false);
          const now = Date.now();
          if (now - processedRef.current < 300) return;
          processedRef.current = now;

          const paths = event.payload.paths.filter(isImagePath);
          if (paths.length > 0) {
            callbackRef.current(paths);
          }
        } else {
          setDragging(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [disabled]);

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      if (disabled || !activeRef.current || isEditableTarget(event.target)) {
        return;
      }

      const imageItems = Array.from(event.clipboardData?.items ?? []).filter(
        (item) => item.type.startsWith("image/")
      );
      if (imageItems.length === 0) return;

      event.preventDefault();

      const paths: string[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;

        try {
          const buffer = await file.arrayBuffer();
          const path = await savePastedImageToTemp(
            Array.from(new Uint8Array(buffer)),
            {
              fileName: file.name || undefined,
              mimeType: file.type || undefined,
            }
          );
          if (isImagePath(path)) {
            paths.push(path);
          }
        } catch (e) {
          console.error("Paste image error:", e);
        }
      }

      if (paths.length > 0) {
        callbackRef.current(paths);
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [disabled]);

  const handleBrowse = useCallback(async () => {
    if (disabled) return;
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: "Images", extensions: IMAGE_EXTENSIONS },
        ],
      });
      if (selected) {
        const paths: string[] = Array.isArray(selected)
          ? selected
          : [selected];
        const filtered = paths.filter(
          (p) => typeof p === "string" && p.length > 0
        );
        if (filtered.length > 0) {
          onFilesSelected(filtered);
        }
      }
    } catch (e) {
      console.error("File dialog error:", e);
    }
  }, [disabled, onFilesSelected]);

  function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = urlInput.trim();
    if (url && onUrlSubmit) {
      onUrlSubmit(url);
      setUrlInput("");
      setShowUrl(false);
    }
  }

  return (
    <div className="space-y-2">
      <div
        onClick={handleBrowse}
        className={`
          relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed
          ${compact ? "px-4 py-6" : "px-6 py-10"} text-center transition-all cursor-pointer
          ${
            dragging
              ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
              : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/50 dark:hover:border-zinc-500"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        <div
          className={`${compact ? "mb-2" : "mb-3"} rounded-full p-3 ${
            dragging
              ? "bg-primary-100 text-primary-600 dark:bg-primary-800 dark:text-primary-400"
              : "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
          }`}
        >
          {dragging ? (
            <ImagePlus className="h-5 w-5" />
          ) : (
            <Upload className="h-5 w-5" />
          )}
        </div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {dragging ? "释放以添加图片" : "拖拽图片到此处，或点击选择文件"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          支持 PNG, JPG, WebP, BMP, TIFF, AVIF · 可直接 Cmd/Ctrl+V
        </p>
      </div>

      {onUrlSubmit && (
        <div>
          {!showUrl ? (
            <button
              onClick={() => setShowUrl(true)}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-primary-600 transition disabled:opacity-40"
            >
              <Link className="h-3.5 w-3.5" />
              从 URL 获取图片
            </button>
          ) : (
            <form onSubmit={handleUrlSubmit} className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/image.png"
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                autoFocus
              />
              <button
                type="submit"
                disabled={!urlInput.trim()}
                className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-40 transition"
              >
                获取
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUrl(false);
                  setUrlInput("");
                }}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700 transition"
              >
                取消
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
