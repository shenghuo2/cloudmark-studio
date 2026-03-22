//! Integration tests for OSS upload, blind watermark, and decode watermark.
//!
//! Run with real credentials via environment variables:
//!
//! ```bash
//! OSS_ACCESS_KEY_ID=... \
//! OSS_ACCESS_KEY_SECRET=... \
//! OSS_ENDPOINT=oss-cn-qingdao.aliyuncs.com \
//! OSS_BUCKET=jingneifile \
//! OSS_REGION=cn-qingdao \
//! cargo test --test oss_integration -- --nocapture
//! ```

use std::path::{Path, PathBuf};

use app_lib::config::OssConfig;
use app_lib::imm::client::ImmClient;
use app_lib::oss::client::OssClient;
use app_lib::oss::sign::url_safe_base64_encode;

/// The real test image placed under tests/ directory.
const TEST_IMAGE: &str = "Cute_anime_girl_expression_sticker_with_Good_Nigh-1774020906106.png";

fn get_oss_config() -> Option<OssConfig> {
    let access_key_id = std::env::var("OSS_ACCESS_KEY_ID").ok()?;
    let access_key_secret = std::env::var("OSS_ACCESS_KEY_SECRET").ok()?;
    let endpoint = std::env::var("OSS_ENDPOINT").ok()?;
    let bucket = std::env::var("OSS_BUCKET").ok()?;
    let region = std::env::var("OSS_REGION").ok()?;

    Some(OssConfig {
        access_key_id,
        access_key_secret,
        endpoint,
        bucket,
        region,
        path_prefix: Some("cloudmark-test/".to_string()),
        custom_domain: None,
    })
}

/// Resolve the path to the test image file (tests/ directory).
fn test_image_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    Path::new(manifest_dir).join("tests").join(TEST_IMAGE)
}

// ── Test 1: Upload + Download ────────────────────────────────────────

#[tokio::test]
async fn test_upload_and_download() {
    let config = match get_oss_config() {
        Some(c) => c,
        None => {
            eprintln!("⏭ Skipping: OSS env vars not set");
            return;
        }
    };

    let test_file = test_image_path();
    assert!(test_file.exists(), "Test image not found: {}", test_file.display());

    let client = OssClient::new(config);

    let object_key = format!(
        "cloudmark-test/{}-{}", uuid::Uuid::new_v4(), TEST_IMAGE
    );

    // Upload
    println!("📤 Uploading to: {}", object_key);
    let result = client.upload_file(&test_file, &object_key).await;
    assert!(result.is_ok(), "Upload failed: {:?}", result.err());
    println!("✅ Upload succeeded");

    // Download and verify
    println!("📥 Downloading: {}", object_key);
    let downloaded = client.download(&object_key).await;
    assert!(downloaded.is_ok(), "Download failed: {:?}", downloaded.err());

    let original = std::fs::read(&test_file).unwrap();
    let downloaded_data = downloaded.unwrap();
    assert_eq!(original.len(), downloaded_data.len(), "File size mismatch");
    assert_eq!(original, downloaded_data, "Content mismatch");
    println!("✅ Download verified — {} bytes match", original.len());

    // Public URL
    let url = client.public_url(&object_key);
    println!("🔗 Public URL: {}", url);

    // Cleanup
    println!("🗑 Deleting...");
    let del = client.delete(&object_key).await;
    assert!(del.is_ok(), "Delete failed: {:?}", del.err());
    println!("✅ Cleanup done");
}

// ── Test 2: Add blind watermark ──────────────────────────────────────

#[tokio::test]
async fn test_add_blind_watermark() {
    let config = match get_oss_config() {
        Some(c) => c,
        None => {
            eprintln!("⏭ Skipping: OSS env vars not set");
            return;
        }
    };

    let test_file = test_image_path();
    assert!(test_file.exists(), "Test image not found: {}", test_file.display());

    let client = OssClient::new(config);
    let uuid = uuid::Uuid::new_v4();
    let source_key = format!("cloudmark-test/__tmp/{}-source.png", uuid);
    let output_key = format!("cloudmark-test/watermarked/{}-wm.png", uuid);

    // Step 1: Upload source
    println!("📤 Uploading source: {}", source_key);
    client.upload_file(&test_file, &source_key).await.expect("Upload failed");
    println!("✅ Source uploaded ({} bytes)", std::fs::metadata(&test_file).unwrap().len());

    // Step 2: Add blind watermark
    let watermark_text = "CloudMark测试水印";
    println!(
        "🔏 Adding watermark: '{}' -> encoded: '{}'",
        watermark_text,
        url_safe_base64_encode(watermark_text)
    );
    let wm_result = client
        .add_blind_watermark(&source_key, &output_key, watermark_text, "low", None)
        .await;

    match &wm_result {
        Ok(key) => println!("✅ Watermark added -> {}", key),
        Err(e) => println!("❌ Watermark failed: {}", e),
    }
    assert!(wm_result.is_ok(), "Watermark failed: {:?}", wm_result.err());

    // Step 3: Verify watermarked image exists by downloading
    println!("📥 Downloading watermarked image...");
    let wm_data = client.download(&output_key).await.expect("Download watermarked failed");
    assert!(!wm_data.is_empty(), "Watermarked image is empty");
    println!("✅ Watermarked image: {} bytes", wm_data.len());

    // Save to temp for inspection
    let tmp_dir = std::env::temp_dir().join("cloudmark-test");
    std::fs::create_dir_all(&tmp_dir).unwrap();
    let local_output = tmp_dir.join(format!("{}-watermarked.png", uuid));
    std::fs::write(&local_output, &wm_data).unwrap();
    println!("💾 Saved to: {}", local_output.display());

    // Cleanup
    println!("🗑 Cleaning up OSS...");
    let _ = client.delete(&source_key).await;
    let _ = client.delete(&output_key).await;
    println!("✅ Done");
}

// ── Test 3: Full flow — add watermark + decode + poll result ─────────

#[tokio::test]
async fn test_add_and_decode_watermark() {
    let config = match get_oss_config() {
        Some(c) => c,
        None => {
            eprintln!("⏭ Skipping: OSS env vars not set");
            return;
        }
    };

    let imm_project = std::env::var("IMM_PROJECT")
        .unwrap_or_else(|_| "watermark-add".to_string());

    let test_file = test_image_path();
    assert!(test_file.exists(), "Test image not found: {}", test_file.display());

    let oss = OssClient::new(config.clone());
    let imm = ImmClient::new(config);
    let uuid = uuid::Uuid::new_v4();
    let source_key = format!("cloudmark-test/__tmp/{}-source.png", uuid);
    let output_key = format!("cloudmark-test/watermarked/{}-wm.png", uuid);

    // Step 1: Upload + add watermark
    println!("📤 Uploading source...");
    oss.upload_file(&test_file, &source_key).await.expect("Upload failed");

    let watermark_text = "版权所有CloudMark";
    println!("🔏 Adding watermark: '{}'", watermark_text);
    oss.add_blind_watermark(&source_key, &output_key, watermark_text, "low", None)
        .await
        .expect("Add watermark failed");
    println!("✅ Watermark added");

    // Step 2: Submit decode watermark (async)
    let topic = "cloudmark-watermark-test";
    println!("🔍 Submitting decode request for: {}", output_key);
    let decode_result = oss
        .decode_blind_watermark(&output_key, "low", topic)
        .await
        .expect("Decode request failed");

    println!("✅ Decode submitted — TaskId: {}", decode_result.task_id);

    // Step 3: Poll for result (retry up to 30s)
    println!("⏳ Polling for decode result...");
    let mut final_status = String::new();
    for i in 0..15 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let task = imm
            .get_task(&imm_project, "DecodeBlindWatermark", &decode_result.task_id)
            .await;

        match task {
            Ok(info) => {
                let status = info.status.clone().unwrap_or_default();
                println!("   [{:>2}s] Status: {}  Progress: {}%",
                    (i + 1) * 2,
                    status,
                    info.progress.unwrap_or(0),
                );

                if status == "Succeeded" {
                    println!("\n🎉 Decode task succeeded! Fetching watermark content...");
                    let wm = imm
                        .get_decode_watermark_result(&imm_project, &decode_result.task_id)
                        .await
                        .expect("GetDecodeBlindWatermarkResult failed");
                    let content = wm.content.clone().unwrap_or_default();
                    println!("   📝 Extracted watermark: '{}'", content);
                    assert_eq!(
                        content, watermark_text,
                        "Decoded watermark does not match original"
                    );
                    println!("   ✅ Watermark matches original!");
                    final_status = status;
                    break;
                } else if status == "Failed" {
                    println!("\n❌ Decode failed:");
                    println!("   Code: {:?}", info.code);
                    println!("   Message: {:?}", info.message);
                    final_status = status;
                    break;
                }
            }
            Err(e) => {
                println!("   [{:>2}s] Poll error: {}", (i + 1) * 2, e);
            }
        }
    }

    assert_eq!(final_status, "Succeeded", "Decode did not succeed");

    // Step 4: Cleanup (only after decode completes)
    println!("🗑 Cleaning up...");
    let _ = oss.delete(&source_key).await;
    let _ = oss.delete(&output_key).await;
    println!("✅ All done");
}

// ── Test 4: Base64 encoding sanity ───────────────────────────────────

#[test]
fn test_url_safe_base64() {
    let result = url_safe_base64_encode("阿里云版权所有");
    assert_eq!(result, "6Zi_6YeM5LqR54mI5p2D5omA5pyJ");
    println!("✅ 阿里云版权所有 -> {}", result);

    let result2 = url_safe_base64_encode("CloudMark测试水印");
    println!("✅ CloudMark测试水印 -> {}", result2);

    let result3 = url_safe_base64_encode("版权所有CloudMark");
    println!("✅ 版权所有CloudMark -> {}", result3);
}
