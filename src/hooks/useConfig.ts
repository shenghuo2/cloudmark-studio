import { useState, useEffect, useCallback } from "react";
import type { AppConfig, OssConfig, WatermarkConfig } from "../lib/tauri";
import {
  getConfig,
  saveOssConfig,
  saveWatermarkConfig,
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
        watermark: { content: "", strength: "low", quality: 90 },
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
        prev ? { ...prev, oss } : { oss, watermark: { content: "", strength: "low", quality: 90 } }
      );
    },
    []
  );

  const updateWatermark = useCallback(
    async (watermark: WatermarkConfig) => {
      await saveWatermarkConfig(watermark);
      setConfig((prev) =>
        prev ? { ...prev, watermark } : { oss: null, watermark }
      );
    },
    []
  );

  return { config, loading, error, reload: load, updateOss, updateWatermark };
}
