import { invoke } from "@tauri-apps/api/core";

// ── Types ────────────────────────────────────────────────────────────

export interface OssConfig {
  access_key_id: string;
  access_key_secret: string;
  endpoint: string;
  bucket: string;
  region: string;
  path_prefix: string | null;
  custom_domain: string | null;
}

export interface WatermarkConfig {
  content: string;
  strength: string;
  quality: number | null;
}

export interface AppConfig {
  oss: OssConfig | null;
  watermark: WatermarkConfig;
}

export interface UploadResult {
  object_key: string;
  url: string;
}

export interface WatermarkResult {
  source_key: string;
  output_key: string;
  url: string;
}

export interface DecodeSubmitResult {
  task_id: string;
  request_id: string;
}

export interface DecodeResult {
  status: string;
  content: string | null;
  message: string | null;
}

// ── Config API ───────────────────────────────────────────────────────

export async function getConfig(): Promise<AppConfig> {
  return invoke("get_config");
}

export async function saveOssConfig(oss: OssConfig): Promise<void> {
  return invoke("save_oss_config", { oss });
}

export async function saveWatermarkConfig(
  watermark: WatermarkConfig
): Promise<void> {
  return invoke("save_watermark_config", { watermark });
}

// ── OSS API ──────────────────────────────────────────────────────────

export async function uploadToOss(
  filePath: string,
  objectKey?: string
): Promise<UploadResult> {
  return invoke("upload_to_oss", {
    filePath,
    objectKey: objectKey ?? null,
  });
}

export async function downloadFromOss(
  objectKey: string,
  savePath: string
): Promise<string> {
  return invoke("download_from_oss", { objectKey, savePath });
}

export async function deleteFromOss(objectKey: string): Promise<void> {
  return invoke("delete_from_oss", { objectKey });
}

// ── Watermark API ────────────────────────────────────────────────────

export async function addWatermark(
  filePath: string,
  opts?: {
    watermarkText?: string;
    strength?: string;
    quality?: number;
    keepOriginal?: boolean;
  }
): Promise<WatermarkResult> {
  return invoke("add_watermark", {
    filePath,
    watermarkText: opts?.watermarkText ?? null,
    strength: opts?.strength ?? null,
    quality: opts?.quality ?? null,
    keepOriginal: opts?.keepOriginal ?? null,
  });
}

export async function decodeWatermark(
  objectKey: string,
  strength?: string,
  notifyTopic?: string
): Promise<DecodeSubmitResult> {
  return invoke("decode_watermark", {
    objectKey,
    strength: strength ?? null,
    notifyTopic: notifyTopic ?? null,
  });
}

export async function getDecodeResult(
  taskId: string,
  immProject?: string
): Promise<DecodeResult> {
  return invoke("get_decode_result", {
    taskId,
    immProject: immProject ?? null,
  });
}

// ── Image Compression API ───────────────────────────────────────────

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  file_size: number;
}

export interface CompressResult {
  output_path: string;
  original_size: number;
  compressed_size: number;
  width: number;
  height: number;
  format: string;
}

export async function getImageInfo(path: string): Promise<ImageInfo> {
  return invoke("get_image_info", { path });
}

export async function compressImage(
  inputPath: string,
  opts: {
    format: string;
    quality: number;
    outputDir?: string;
    pngLevel?: number;
    width?: number;
    height?: number;
  }
): Promise<CompressResult> {
  return invoke("compress_image", {
    inputPath,
    outputDir: opts.outputDir ?? null,
    format: opts.format,
    quality: opts.quality,
    pngLevel: opts.pngLevel ?? null,
    width: opts.width ?? null,
    height: opts.height ?? null,
  });
}
