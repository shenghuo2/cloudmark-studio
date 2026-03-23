import { useState, useEffect, useCallback } from "react";
import type { AppConfig, OssConfig, WatermarkConfig, CompressConfig, DecodeConfig } from "../lib/tauri";
import {
  getConfig,
  saveOssConfig,
  saveWatermarkConfig,
  saveCompressConfig,
  saveDecodeConfig,
} from "../lib/tauri";

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await getConfig();
      setConfig(cfg);
      setError(null);
    } catch (e) {
      // Fallback for browser preview (no Tauri runtime)
      console.warn("Failed to load config (browser mode?):", e);
      setConfig({
        oss: null,
        watermark: { content: "", strength: "low", quality: 90, rename_template_enabled: false, rename_template: "{date}-{name}-watermarked-{n}" },
        compress: { auto_save: false },
        decode: { auto_delete: true },
      });
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateOss = useCallback(
    async (oss: OssConfig) => {
      await saveOssConfig(oss);
      setConfig((prev) =>
        prev ? { ...prev, oss } : { oss, watermark: { content: "", strength: "low", quality: 90, rename_template_enabled: false, rename_template: "{date}-{name}-watermarked-{n}" }, compress: { auto_save: false }, decode: { auto_delete: true } }
      );
    },
    []
  );

  const updateWatermark = useCallback(
    async (watermark: WatermarkConfig) => {
      await saveWatermarkConfig(watermark);
      setConfig((prev) =>
        prev ? { ...prev, watermark } : { oss: null, watermark, compress: { auto_save: false }, decode: { auto_delete: true } }
      );
    },
    []
  );

  const updateCompress = useCallback(
    async (compress: CompressConfig) => {
      await saveCompressConfig(compress);
      setConfig((prev) =>
        prev ? { ...prev, compress } : { oss: null, watermark: { content: "", strength: "low", quality: 90, rename_template_enabled: false, rename_template: "{date}-{name}-watermarked-{n}" }, compress, decode: { auto_delete: true } }
      );
    },
    []
  );

  const updateDecode = useCallback(
    async (decode: DecodeConfig) => {
      await saveDecodeConfig(decode);
      setConfig((prev) =>
        prev ? { ...prev, decode } : { oss: null, watermark: { content: "", strength: "low", quality: 90, rename_template_enabled: false, rename_template: "{date}-{name}-watermarked-{n}" }, compress: { auto_save: false }, decode }
      );
    },
    []
  );

  return { config, loading, error, reload: load, updateOss, updateWatermark, updateCompress, updateDecode };
}
