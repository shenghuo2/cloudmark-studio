use chrono::Local;
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::State;

use crate::config::{AppConfig, CompressConfig, DecodeConfig, OssConfig, WatermarkConfig};
use crate::imm::client::ImmClient;
use crate::oss::client::OssClient;
use crate::watermark::encode;

/// Shared app state managed by Tauri.
pub struct AppState {
    pub config: Mutex<AppConfig>,
    #[cfg(target_os = "linux")]
    pub clipboard: Mutex<Option<arboard::Clipboard>>,
}

const DEFAULT_RENAME_TEMPLATE: &str = "{date}-{name}-watermarked-{n}";
static OUTPUT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn short_hex_id() -> String {
    uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect()
}

fn sanitize_filename_component(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => '-',
            _ => ch,
        })
        .collect();
    let sanitized = sanitized.trim();
    if sanitized.is_empty() || sanitized.chars().all(|ch| ch == '.') {
        "image".to_string()
    } else {
        sanitized.to_string()
    }
}

fn normalized_source_file_name(source_name: &str) -> String {
    let fallback_name = "image";
    let file_name = Path::new(source_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(fallback_name);
    let file_path = Path::new(file_name);
    let source_stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or(fallback_name);
    let source_ext = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| !ext.trim().is_empty())
        .map(|ext| format!(".{}", ext))
        .unwrap_or_default();

    format!("{}{}", sanitize_filename_component(source_stem), source_ext)
}

fn output_file_name_from_template(template: &str, source_name: &str) -> String {
    let fallback_name = "image";
    let file_name = Path::new(source_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(fallback_name);
    let file_path = Path::new(file_name);
    let source_stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or(fallback_name);
    let source_ext = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| !ext.trim().is_empty())
        .map(|ext| format!(".{}", ext))
        .unwrap_or_default();

    let now = Local::now();
    let sequence = OUTPUT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let short_id = short_hex_id();
    let template = if template.trim().is_empty() {
        DEFAULT_RENAME_TEMPLATE
    } else {
        template.trim()
    };

    let rendered = template
        .replace("{date}", &now.format("%Y%m%d").to_string())
        .replace("{time}", &now.format("%H%M%S").to_string())
        .replace("{datetime}", &now.format("%Y%m%d-%H%M%S").to_string())
        .replace("{name}", &sanitize_filename_component(source_stem))
        .replace("{n}", &sequence.to_string())
        .replace("{id}", &short_id);
    let rendered = sanitize_filename_component(&rendered);

    if !source_ext.is_empty() && rendered.to_lowercase().ends_with(&source_ext.to_lowercase()) {
        rendered
    } else {
        format!("{}{}", rendered, source_ext)
    }
}

async fn load_image_bytes(image_source: &str) -> Result<Vec<u8>, String> {
    if image_source.starts_with("http://") || image_source.starts_with("https://") {
        let client = reqwest::Client::builder()
            .user_agent("CloudMark/0.1")
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let resp = client
            .get(image_source)
            .send()
            .await
            .map_err(|e| format!("下载图片失败: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("下载图片失败: HTTP {}", resp.status()));
        }

        resp.bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|e| format!("读取图片失败: {}", e))
    } else {
        tokio::fs::read(image_source)
            .await
            .map_err(|e| format!("读取图片文件失败: {}", e))
    }
}

// ── Config commands ──────────────────────────────────────────────────

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
pub fn save_oss_config(state: State<'_, AppState>, oss: OssConfig) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.oss = Some(oss);
    config.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_watermark_config(
    state: State<'_, AppState>,
    watermark: WatermarkConfig,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.watermark = watermark;
    config.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_compress_config(
    state: State<'_, AppState>,
    compress: CompressConfig,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.compress = compress;
    config.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_decode_config(
    state: State<'_, AppState>,
    decode: DecodeConfig,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.decode = decode;
    config.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn copy_image_to_clipboard(
    state: State<'_, AppState>,
    image_source: String,
) -> Result<(), String> {
    let bytes = load_image_bytes(&image_source).await?;
    let decoded = image::load_from_memory(&bytes)
        .map_err(|e| format!("解析图片失败: {}", e))?
        .to_rgba8();
    let (width, height) = decoded.dimensions();
    let image = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(decoded.into_raw()),
    };

    #[cfg(target_os = "linux")]
    {
        let mut clipboard_guard = state.clipboard.lock().map_err(|e| e.to_string())?;
        if clipboard_guard.is_none() {
            *clipboard_guard = Some(
                arboard::Clipboard::new().map_err(|e| format!("打开系统剪贴板失败: {}", e))?,
            );
        }

        return clipboard_guard
            .as_mut()
            .ok_or_else(|| "剪贴板不可用".to_string())?
            .set_image(image)
            .map_err(|e| format!("写入系统剪贴板失败: {}", e));
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = state;
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("打开系统剪贴板失败: {}", e))?;
        return clipboard
            .set_image(image)
            .map_err(|e| format!("写入系统剪贴板失败: {}", e));
    }
}

// ── OSS commands ─────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct UploadResult {
    pub object_key: String,
    pub url: String,
}

#[tauri::command]
pub async fn upload_to_oss(
    state: State<'_, AppState>,
    file_path: String,
    object_key: Option<String>,
) -> Result<UploadResult, String> {
    let config = {
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.oss
            .clone()
            .ok_or_else(|| "OSS not configured".to_string())?
    };

    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Generate object key if not provided
    let key = object_key.unwrap_or_else(|| {
        let prefix = config.path_prefix.as_deref().unwrap_or("");
        let filename = path.file_name().unwrap().to_str().unwrap();
        let short_id = short_hex_id();
        format!("{}{}-{}", prefix, short_id, filename)
    });

    let client = OssClient::new(config);
    let uploaded_key = client
        .upload_file(&path, &key)
        .await
        .map_err(|e| e.to_string())?;

    let url = client.public_url(&uploaded_key);
    Ok(UploadResult {
        object_key: uploaded_key,
        url,
    })
}

#[tauri::command]
pub async fn list_oss_objects(
    state: State<'_ , AppState>,
    prefix: Option<String>,
    continuation_token: Option<String>,
    delimiter: Option<String>,
    max_keys: Option<u32>,
) -> Result<crate::oss::client::ListObjectsResult, String> {
    let oss_config = {
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.oss
            .clone()
            .ok_or_else(|| "OSS not configured".to_string())?
    };

    let normalized_prefix = prefix
        .unwrap_or_default()
        .trim()
        .trim_start_matches('/')
        .to_string();
    let normalized_prefix = if normalized_prefix.is_empty() {
        String::new()
    } else if normalized_prefix.ends_with('/') {
        normalized_prefix
    } else {
        format!("{}/", normalized_prefix)
    };

    let client = OssClient::new(oss_config);
    client
        .list_objects(
            Some(normalized_prefix.as_str()),
            delimiter.as_deref(),
            continuation_token.as_deref(),
            max_keys,
        )
        .await
        .map_err(|e| format!("List OSS objects failed: {}", e))
}

// ── Watermark commands ───────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct WatermarkResult {
    pub source_key: String,
    pub output_key: String,
    pub url: String,
}

/// Upload a local image to OSS, add blind watermark, and return the result.
///
/// Flow:
/// 1. Upload original image to OSS (temp key)
/// 2. Call blind watermark API to create watermarked copy
/// 3. Optionally delete the temp original
/// 4. Return the watermarked image URL
#[tauri::command]
pub async fn add_watermark(
    state: State<'_, AppState>,
    file_path: Option<String>,
    object_key: Option<String>,
    watermark_text: Option<String>,
    strength: Option<String>,
    quality: Option<u8>,
    source_name: Option<String>,
    keep_original: Option<bool>,
) -> Result<WatermarkResult, String> {
    let (oss_config, wm_config) = {
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        let oss = cfg
            .oss
            .clone()
            .ok_or_else(|| "OSS not configured".to_string())?;
        (oss, cfg.watermark.clone())
    };

    let text = watermark_text.unwrap_or(wm_config.content.clone());
    let str_val = strength.unwrap_or(wm_config.strength.clone());
    let q = quality.or(wm_config.quality);

    // Validate
    encode::validate_watermark_text(&text).map_err(|e| e.to_string())?;
    encode::validate_strength(&str_val).map_err(|e| e.to_string())?;
    if let Some(q_val) = q {
        encode::validate_quality(q_val).map_err(|e| e.to_string())?;
    }

    let client = OssClient::new(oss_config.clone());
    let prefix = oss_config.path_prefix.as_deref().unwrap_or("");
    let short_id = short_hex_id();

    // Determine source_key: use existing object_key or upload local file
    let source_key = if let Some(key) = object_key {
        key
    } else if let Some(fp) = &file_path {
        let path = PathBuf::from(fp);
        if !path.exists() {
            return Err(format!("File not found: {}", fp));
        }
        let filename = path.file_name().unwrap().to_str().unwrap();
        let key = format!("{}__tmp/{}-{}", prefix, short_id, filename);
        client
            .upload_file(&path, &key)
            .await
            .map_err(|e| format!("Upload failed: {}", e))?;
        key
    } else {
        return Err("Either file_path or object_key must be provided".to_string());
    };

    let source_name = source_name
        .filter(|name| !name.trim().is_empty())
        .or_else(|| {
            file_path.as_ref().and_then(|path| {
                Path::new(path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.to_string())
            })
        })
        .unwrap_or_else(|| source_key.split('/').last().unwrap_or(&source_key).to_string());
    let output_filename = if wm_config.rename_template_enabled {
        output_file_name_from_template(&wm_config.rename_template, &source_name)
    } else {
        format!("{}-{}", short_id, normalized_source_file_name(&source_name))
    };
    let output_key = format!("{}watermarked/{}", prefix, output_filename);

    // Add blind watermark
    let result = client
        .add_blind_watermark(&source_key, &output_key, &text, &str_val, q)
        .await;

    // Cleanup temp file only if explicitly requested
    if keep_original == Some(false) {
        let _ = client.delete(&source_key).await;
    }

    let output = result.map_err(|e| format!("Watermark failed: {}", e))?;
    let url = client.public_url(&output);

    Ok(WatermarkResult {
        source_key,
        output_key: output,
        url,
    })
}

/// Download a watermarked image from OSS to local filesystem.
#[tauri::command]
pub async fn download_from_oss(
    state: State<'_, AppState>,
    object_key: String,
    save_path: String,
) -> Result<String, String> {
    let oss_config = {
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.oss
            .clone()
            .ok_or_else(|| "OSS not configured".to_string())?
    };

    let client = OssClient::new(oss_config);
    let data = client
        .download(&object_key)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    tokio::fs::write(&save_path, &data)
        .await
        .map_err(|e| format!("Failed to save file: {}", e))?;

    Ok(save_path)
}

/// Delete an object from OSS.
#[tauri::command]
pub async fn delete_from_oss(
    state: State<'_, AppState>,
    object_key: String,
) -> Result<(), String> {
    let oss_config = {
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.oss
            .clone()
            .ok_or_else(|| "OSS not configured".to_string())?
    };

    let client = OssClient::new(oss_config);
    client
        .delete(&object_key)
        .await
        .map_err(|e| format!("Delete failed: {}", e))?;

    Ok(())
}

// ── OSS rename command ──────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct RenameResult {
    pub new_key: String,
    pub url: String,
}

#[tauri::command]
pub async fn rename_oss_object(
    state: State<'_, AppState>,
    object_key: String,
    new_name: String,
) -> Result<RenameResult, String> {
    let oss_config = {
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.oss
            .clone()
            .ok_or_else(|| "OSS not configured".to_string())?
    };

    // Build new key: keep the same directory prefix, just change the filename
    let prefix = if let Some(pos) = object_key.rfind('/') {
        &object_key[..=pos]
    } else {
        ""
    };
    let new_key = format!("{}{}", prefix, new_name);

    if new_key == object_key {
        let client = OssClient::new(oss_config);
        return Ok(RenameResult {
            url: client.public_url(&new_key),
            new_key,
        });
    }

    let client = OssClient::new(oss_config);
    client
        .copy_object(&object_key, &new_key)
        .await
        .map_err(|e| format!("复制失败: {}", e))?;
    client
        .delete(&object_key)
        .await
        .map_err(|e| format!("删除旧文件失败: {}", e))?;

    let url = client.public_url(&new_key);
    Ok(RenameResult { new_key, url })
}

// ── Decode watermark commands ────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct DecodeSubmitResult {
    pub task_id: String,
    pub request_id: String,
}

#[derive(serde::Serialize)]
pub struct DecodeResult {
    pub status: String,
    pub content: Option<String>,
    pub message: Option<String>,
}

/// Submit async decode blind watermark request.
/// The image must already be on OSS.
#[tauri::command]
pub async fn decode_watermark(
    state: State<'_, AppState>,
    object_key: String,
    strength: Option<String>,
    notify_topic: Option<String>,
) -> Result<DecodeSubmitResult, String> {
    let oss_config = {
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.oss
            .clone()
            .ok_or_else(|| "OSS not configured".to_string())?
    };

    let s = strength.unwrap_or_else(|| "low".to_string());
    let topic = notify_topic.unwrap_or_else(|| "cloudmark-decode".to_string());

    let client = OssClient::new(oss_config);
    let result = client
        .decode_blind_watermark(&object_key, &s, &topic)
        .await
        .map_err(|e| format!("Decode request failed: {}", e))?;

    Ok(DecodeSubmitResult {
        task_id: result.task_id,
        request_id: result.request_id,
    })
}

/// Poll the decode watermark task result via IMM API.
#[tauri::command]
pub async fn get_decode_result(
    state: State<'_, AppState>,
    task_id: String,
    imm_project: Option<String>,
) -> Result<DecodeResult, String> {
    let oss_config = {
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.oss
            .clone()
            .ok_or_else(|| "OSS not configured".to_string())?
    };

    let project = imm_project.unwrap_or_else(|| "watermark-add".to_string());
    let imm = ImmClient::new(oss_config);

    let result = imm
        .get_decode_watermark_result(&project, &task_id)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    Ok(DecodeResult {
        status: result.status.unwrap_or_default(),
        content: result.content,
        message: result.message,
    })
}

// ── URL download command ─────────────────────────────────────────────

#[tauri::command]
pub async fn download_url_to_temp(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .header("Accept", "image/*,*/*;q=0.8")
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }

    // Verify content type is an image
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !content_type.is_empty() && !content_type.starts_with("image/") {
        return Err(format!(
            "URL 返回的不是图片 (Content-Type: {})，请提供图片的直链",
            content_type
        ));
    }

    // Extract filename from URL
    let url_path = url.split('?').next().unwrap_or(&url);
    let filename = url_path.split('/').last().unwrap_or("image.png");
    let filename = if filename.is_empty() { "image.png" } else { filename };

    let temp_dir = std::env::temp_dir().join("cloudmark-downloads");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    let dest = temp_dir.join(format!("{}-{}", uuid::Uuid::new_v4(), filename));
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_pasted_image_to_temp(
    bytes: Vec<u8>,
    file_name: Option<String>,
    mime_type: Option<String>,
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("剪贴板中没有图片数据".to_string());
    }

    let ext = file_name
        .as_deref()
        .and_then(|name| std::path::Path::new(name).extension().and_then(|ext| ext.to_str()))
        .map(|ext| ext.to_ascii_lowercase())
        .filter(|ext| {
            matches!(
                ext.as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "bmp" | "tiff" | "tif" | "gif" | "avif"
            )
        })
        .or_else(|| {
            mime_type.as_deref().and_then(|mime| match mime {
                "image/png" => Some("png".to_string()),
                "image/jpeg" => Some("jpg".to_string()),
                "image/webp" => Some("webp".to_string()),
                "image/bmp" => Some("bmp".to_string()),
                "image/tiff" => Some("tiff".to_string()),
                "image/gif" => Some("gif".to_string()),
                "image/avif" => Some("avif".to_string()),
                _ => None,
            })
        })
        .or_else(|| {
            image::guess_format(&bytes).ok().map(|format| match format {
                image::ImageFormat::Png => "png".to_string(),
                image::ImageFormat::Jpeg => "jpg".to_string(),
                image::ImageFormat::WebP => "webp".to_string(),
                image::ImageFormat::Bmp => "bmp".to_string(),
                image::ImageFormat::Tiff => "tiff".to_string(),
                image::ImageFormat::Gif => "gif".to_string(),
                image::ImageFormat::Avif => "avif".to_string(),
                _ => "png".to_string(),
            })
        })
        .unwrap_or_else(|| "png".to_string());

    let temp_dir = std::env::temp_dir().join("cloudmark-paste");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("创建临时目录失败: {}", e))?;

    let file_stem = file_name
        .as_deref()
        .and_then(|name| {
            std::path::Path::new(name)
                .file_stem()
                .and_then(|stem| stem.to_str())
        })
        .filter(|stem| !stem.is_empty())
        .unwrap_or("pasted-image");

    let dest = temp_dir.join(format!("{}-{}.{}", file_stem, uuid::Uuid::new_v4(), ext));
    tokio::fs::write(&dest, bytes)
        .await
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

// ── Image compression commands ───────────────────────────────────────

#[tauri::command]
pub fn get_temp_dir() -> String {
    let dir = std::env::temp_dir().join("cloudmark-compress");
    let _ = std::fs::create_dir_all(&dir);
    dir.to_string_lossy().to_string()
}

#[tauri::command]
pub async fn get_image_info(path: String) -> Result<crate::imaging::compress::ImageInfo, String> {
    tokio::task::spawn_blocking(move || {
        crate::imaging::compress::get_image_info(&path)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("Failed to read image info: {}", e))
}

#[tauri::command]
pub async fn compress_image(
    input_path: String,
    output_dir: Option<String>,
    format: String,
    quality: u8,
    png_level: Option<u8>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<crate::imaging::compress::CompressResult, String> {
    log::info!(
        "compress_image: path={}, format={}, quality={}, png_level={:?}, resize={}x{}",
        input_path, format, quality, png_level,
        width.unwrap_or(0), height.unwrap_or(0)
    );
    tokio::task::spawn_blocking(move || {
        let opts = crate::imaging::compress::CompressOptions {
            format,
            quality,
            png_level,
            width,
            height,
        };
        crate::imaging::compress::compress_image(
            &input_path,
            output_dir.as_deref(),
            &opts,
        )
    })
    .await
    .map_err(|e| format!("Task join error (panic?): {}", e))?
    .map_err(|e| format!("Compression failed: {}", e))
}
