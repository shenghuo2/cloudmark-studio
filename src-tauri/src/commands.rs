use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::config::{AppConfig, OssConfig, WatermarkConfig};
use crate::imm::client::ImmClient;
use crate::oss::client::OssClient;
use crate::watermark::encode;

/// Shared app state managed by Tauri.
pub struct AppState {
    pub config: Mutex<AppConfig>,
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
        let uuid = uuid::Uuid::new_v4();
        format!("{}{}-{}", prefix, uuid, filename)
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
    file_path: String,
    watermark_text: Option<String>,
    strength: Option<String>,
    quality: Option<u8>,
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

    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let filename = path
        .file_name()
        .unwrap()
        .to_str()
        .unwrap();
    let uuid = uuid::Uuid::new_v4();
    let prefix = oss_config.path_prefix.as_deref().unwrap_or("");
    let source_key = format!("{}__tmp/{}-{}", prefix, uuid, filename);
    let output_key = format!("{}watermarked/{}-{}", prefix, uuid, filename);

    let client = OssClient::new(oss_config);

    // Step 1: Upload original
    client
        .upload_file(&path, &source_key)
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    // Step 2: Add blind watermark
    let result = client
        .add_blind_watermark(&source_key, &output_key, &text, &str_val, q)
        .await;

    // Step 3: Cleanup temp file only if explicitly requested
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

// ── Image compression commands ───────────────────────────────────────

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
