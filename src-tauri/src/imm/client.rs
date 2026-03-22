use anyhow::{Context, Result};
use chrono::Utc;
use hmac::Mac;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use crate::config::OssConfig;

/// IMM API client for querying async task results.
/// Uses Alibaba Cloud RPC style API with V3 signature (ACS3-HMAC-SHA256).
pub struct ImmClient {
    config: OssConfig,
    http: reqwest::Client,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskInfo {
    #[serde(rename = "RequestId")]
    pub request_id: Option<String>,
    #[serde(rename = "ProjectName")]
    pub project_name: Option<String>,
    #[serde(rename = "TaskId")]
    pub task_id: Option<String>,
    #[serde(rename = "TaskType")]
    pub task_type: Option<String>,
    #[serde(rename = "Status")]
    pub status: Option<String>,
    #[serde(rename = "Code")]
    pub code: Option<String>,
    #[serde(rename = "Message")]
    pub message: Option<String>,
    #[serde(rename = "StartTime")]
    pub start_time: Option<String>,
    #[serde(rename = "EndTime")]
    pub end_time: Option<String>,
    #[serde(rename = "Progress")]
    pub progress: Option<i64>,
    /// Raw JSON for any extra fields we didn't model
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Result from GetDecodeBlindWatermarkResult API — includes the watermark text.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DecodeWatermarkTaskResult {
    #[serde(rename = "RequestId")]
    pub request_id: Option<String>,
    #[serde(rename = "ProjectName")]
    pub project_name: Option<String>,
    #[serde(rename = "TaskId")]
    pub task_id: Option<String>,
    #[serde(rename = "TaskType")]
    pub task_type: Option<String>,
    #[serde(rename = "Status")]
    pub status: Option<String>,
    #[serde(rename = "Code")]
    pub code: Option<String>,
    #[serde(rename = "Message")]
    pub message: Option<String>,
    #[serde(rename = "StartTime")]
    pub start_time: Option<String>,
    #[serde(rename = "EndTime")]
    pub end_time: Option<String>,
    /// The extracted watermark text content.
    #[serde(rename = "Content")]
    pub content: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

impl ImmClient {
    pub fn new(config: OssConfig) -> Self {
        Self {
            config,
            http: reqwest::Client::new(),
        }
    }

    /// IMM API host for the region, e.g. "imm.cn-qingdao.aliyuncs.com"
    fn host(&self) -> String {
        format!("imm.{}.aliyuncs.com", self.config.region)
    }

    /// Query an async task by TaskId using IMM GetTask API.
    ///
    /// API: GET https://imm.{region}.aliyuncs.com/?Action=GetTask
    ///   &ProjectName={project}
    ///   &TaskType=DecodeBlindWatermark
    ///   &TaskId={task_id}
    pub async fn get_task(
        &self,
        project_name: &str,
        task_type: &str,
        task_id: &str,
    ) -> Result<TaskInfo> {
        let mut params = BTreeMap::new();
        params.insert("ProjectName".to_string(), project_name.to_string());
        params.insert("TaskType".to_string(), task_type.to_string());
        params.insert("TaskId".to_string(), task_id.to_string());

        let body = self.call_api("GetTask", &params).await?;
        let info: TaskInfo = serde_json::from_str(&body)
            .with_context(|| format!("Failed to parse GetTask response: {}", body))?;
        Ok(info)
    }

    /// Get the decoded blind watermark result (including the watermark text).
    ///
    /// API: GetDecodeBlindWatermarkResult
    /// Returns the `Content` field with the extracted watermark text.
    pub async fn get_decode_watermark_result(
        &self,
        project_name: &str,
        task_id: &str,
    ) -> Result<DecodeWatermarkTaskResult> {
        let mut params = BTreeMap::new();
        params.insert("ProjectName".to_string(), project_name.to_string());
        params.insert("TaskType".to_string(), "DecodeBlindWatermark".to_string());
        params.insert("TaskId".to_string(), task_id.to_string());

        let body = self
            .call_api("GetDecodeBlindWatermarkResult", &params)
            .await?;
        let result: DecodeWatermarkTaskResult = serde_json::from_str(&body)
            .with_context(|| format!("Failed to parse decode result: {}", body))?;
        Ok(result)
    }

    /// Make an RPC API call to IMM with ACS3-HMAC-SHA256 signature.
    async fn call_api(
        &self,
        action: &str,
        params: &BTreeMap<String, String>,
    ) -> Result<String> {
        let host = self.host();
        let now = Utc::now();
        let timestamp = now.format("%Y-%m-%dT%H:%M:%SZ").to_string();

        // Build query string
        let mut query_parts: Vec<String> = params
            .iter()
            .map(|(k, v)| format!("{}={}", urlencoding(k), urlencoding(v)))
            .collect();
        query_parts.sort();
        let query_string = query_parts.join("&");

        // Canonical request for ACS3-HMAC-SHA256
        let method = "GET";
        let canonical_uri = "/";
        let canonical_querystring = &query_string;

        // Headers to sign
        let mut signed_headers_map = BTreeMap::new();
        signed_headers_map.insert("host".to_string(), host.clone());
        signed_headers_map.insert("x-acs-action".to_string(), action.to_string());
        signed_headers_map.insert("x-acs-date".to_string(), timestamp.clone());
        signed_headers_map.insert("x-acs-version".to_string(), "2020-09-30".to_string());
        signed_headers_map.insert(
            "x-acs-signature-nonce".to_string(),
            uuid::Uuid::new_v4().to_string(),
        );

        let signed_headers_names: Vec<String> = signed_headers_map.keys().cloned().collect();
        let signed_headers_str = signed_headers_names.join(";");

        let canonical_headers: String = signed_headers_map
            .iter()
            .map(|(k, v)| format!("{}:{}\n", k, v.trim()))
            .collect();

        // Empty body hash for GET
        let hashed_payload = hex_sha256(b"");

        let canonical_request = format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            method,
            canonical_uri,
            canonical_querystring,
            canonical_headers,
            signed_headers_str,
            hashed_payload,
        );

        let hashed_canonical = hex_sha256(canonical_request.as_bytes());
        let string_to_sign = format!("ACS3-HMAC-SHA256\n{}", hashed_canonical);

        // Sign
        let mut mac = hmac::Hmac::<Sha256>::new_from_slice(
            self.config.access_key_secret.as_bytes(),
        )
        .unwrap();
        mac.update(string_to_sign.as_bytes());
        let signature = hex::encode(mac.finalize().into_bytes());

        let authorization = format!(
            "ACS3-HMAC-SHA256 Credential={},SignedHeaders={},Signature={}",
            self.config.access_key_id, signed_headers_str, signature,
        );

        let url = format!("https://{}/?{}", host, query_string);

        let mut req = self.http.get(&url);
        req = req.header("Host", &host);
        req = req.header("x-acs-action", action);
        req = req.header("x-acs-date", &timestamp);
        req = req.header("x-acs-version", "2020-09-30");
        req = req.header(
            "x-acs-signature-nonce",
            signed_headers_map.get("x-acs-signature-nonce").unwrap(),
        );
        req = req.header("Authorization", &authorization);

        let resp = req.send().await.with_context(|| {
            format!("IMM API call failed: {}", action)
        })?;

        let status = resp.status();
        let body = resp.text().await?;

        if !status.is_success() {
            anyhow::bail!("IMM {} failed ({}): {}", action, status, body);
        }

        Ok(body)
    }
}

fn hex_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}
