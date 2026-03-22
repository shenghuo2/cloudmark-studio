//! Quick test to query the decode watermark async task result.
//!
//! Usage:
//! OSS_ACCESS_KEY_ID=... OSS_ACCESS_KEY_SECRET=... OSS_REGION=cn-qingdao \
//!   TASK_ID=DecodeBlindWatermark-xxx \
//!   IMM_PROJECT=watermark-add \
//!   cargo test --test query_task -- --nocapture

use app_lib::config::OssConfig;
use app_lib::imm::client::ImmClient;

fn get_config() -> Option<OssConfig> {
    Some(OssConfig {
        access_key_id: std::env::var("OSS_ACCESS_KEY_ID").ok()?,
        access_key_secret: std::env::var("OSS_ACCESS_KEY_SECRET").ok()?,
        endpoint: std::env::var("OSS_ENDPOINT").unwrap_or_default(),
        bucket: std::env::var("OSS_BUCKET").unwrap_or_default(),
        region: std::env::var("OSS_REGION").ok()?,
        path_prefix: None,
        custom_domain: None,
    })
}

#[tokio::test]
async fn query_decode_task() {
    let config = match get_config() {
        Some(c) => c,
        None => {
            eprintln!("⏭ Skipping: env vars not set");
            return;
        }
    };

    let task_id = std::env::var("TASK_ID")
        .unwrap_or_else(|_| "DecodeBlindWatermark-b150b6ed-bcc2-4fa4-959c-2497ca504ffa".to_string());
    let project = std::env::var("IMM_PROJECT")
        .unwrap_or_else(|_| "watermark-add".to_string());

    println!("🔍 Querying task: {}", task_id);
    println!("   Project: {}", project);
    println!("   Region: {}", config.region);

    let imm = ImmClient::new(config);

    // 1. GetTask — basic status
    println!("\n── GetTask ──");
    let result = imm
        .get_task(&project, "DecodeBlindWatermark", &task_id)
        .await;
    match &result {
        Ok(info) => {
            println!("   Status: {:?}", info.status);
            println!("   Full:\n   {}", serde_json::to_string_pretty(&info).unwrap());
        }
        Err(e) => println!("❌ GetTask failed: {}", e),
    }

    // 2. GetDecodeBlindWatermarkResult — includes watermark Content
    println!("\n── GetDecodeBlindWatermarkResult ──");
    let wm_result = imm
        .get_decode_watermark_result(&project, &task_id)
        .await;
    match &wm_result {
        Ok(r) => {
            println!("   Status:  {:?}", r.status);
            println!("   Content: {:?}", r.content);
            println!("   Full:\n   {}", serde_json::to_string_pretty(&r).unwrap());
        }
        Err(e) => println!("❌ GetDecodeBlindWatermarkResult failed: {}", e),
    }
}
