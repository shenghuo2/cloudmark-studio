use anyhow::{Context, Result};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, DATE};
use std::path::Path;

use crate::config::OssConfig;
use super::sign;

/// Result from async decode blind watermark request.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DecodeWatermarkResult {
    pub task_id: String,
    pub request_id: String,
    pub raw_response: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OssObjectSummary {
    pub key: String,
    pub name: String,
    pub size: u64,
    pub last_modified: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OssPrefixSummary {
    pub prefix: String,
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ListObjectsResult {
    pub prefix: String,
    pub objects: Vec<OssObjectSummary>,
    pub prefixes: Vec<OssPrefixSummary>,
    pub next_continuation_token: Option<String>,
    pub is_truncated: bool,
}

/// Alibaba Cloud OSS client.
#[derive(Debug, Clone)]
pub struct OssClient {
    config: OssConfig,
    http: reqwest::Client,
}

impl OssClient {
    pub fn new(config: OssConfig) -> Self {
        Self {
            config,
            http: reqwest::Client::new(),
        }
    }

    /// Get the bucket host, e.g. "my-bucket.oss-cn-hangzhou.aliyuncs.com"
    fn bucket_host(&self) -> String {
        format!("{}.{}", self.config.bucket, self.config.endpoint)
    }

    /// Get the full URL for an object key.
    fn object_url(&self, object_key: &str) -> String {
        format!("https://{}/{}", self.bucket_host(), object_key)
    }

    /// Get the public URL for an object (using custom domain if configured).
    pub fn public_url(&self, object_key: &str) -> String {
        if let Some(domain) = &self.config.custom_domain {
            format!("https://{}/{}", domain, object_key)
        } else {
            self.object_url(object_key)
        }
    }

    /// Build the canonicalized resource string.
    fn canonicalized_resource(&self, object_key: &str) -> String {
        format!("/{}/{}", self.config.bucket, object_key)
    }

    /// Build Authorization header value.
    fn authorization(&self, signature: &str) -> String {
        format!("OSS {}:{}", self.config.access_key_id, signature)
    }

    /// Upload a file to OSS.
    /// Returns the object key of the uploaded file.
    pub async fn upload_file(&self, local_path: &Path, object_key: &str) -> Result<String> {
        let data = tokio::fs::read(local_path)
            .await
            .with_context(|| format!("Failed to read file: {}", local_path.display()))?;

        let content_type = mime_from_path(local_path);
        let date = sign::http_date();
        let resource = self.canonicalized_resource(object_key);

        let signature = sign::sign_v1(
            &self.config.access_key_secret,
            "PUT",
            "",
            &content_type,
            &date,
            "",
            &resource,
        );

        let url = self.object_url(object_key);
        let resp = self
            .http
            .put(&url)
            .header(DATE, &date)
            .header(CONTENT_TYPE, &content_type)
            .header(AUTHORIZATION, self.authorization(&signature))
            .body(data)
            .send()
            .await
            .with_context(|| format!("Failed to upload to OSS: {}", object_key))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("OSS upload failed ({}): {}", status, body);
        }

        Ok(object_key.to_string())
    }

    /// Upload bytes to OSS.
    pub async fn upload_bytes(
        &self,
        data: Vec<u8>,
        object_key: &str,
        content_type: &str,
    ) -> Result<String> {
        let date = sign::http_date();
        let resource = self.canonicalized_resource(object_key);

        let signature = sign::sign_v1(
            &self.config.access_key_secret,
            "PUT",
            "",
            content_type,
            &date,
            "",
            &resource,
        );

        let url = self.object_url(object_key);
        let resp = self
            .http
            .put(&url)
            .header(DATE, &date)
            .header(CONTENT_TYPE, content_type)
            .header(AUTHORIZATION, self.authorization(&signature))
            .body(data)
            .send()
            .await
            .with_context(|| format!("Failed to upload to OSS: {}", object_key))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("OSS upload failed ({}): {}", status, body);
        }

        Ok(object_key.to_string())
    }

    /// Download an object from OSS and return its bytes.
    pub async fn download(&self, object_key: &str) -> Result<Vec<u8>> {
        let date = sign::http_date();
        let resource = self.canonicalized_resource(object_key);

        let signature = sign::sign_v1(
            &self.config.access_key_secret,
            "GET",
            "",
            "",
            &date,
            "",
            &resource,
        );

        let url = self.object_url(object_key);
        let resp = self
            .http
            .get(&url)
            .header(DATE, &date)
            .header(AUTHORIZATION, self.authorization(&signature))
            .send()
            .await
            .with_context(|| format!("Failed to download from OSS: {}", object_key))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("OSS download failed ({}): {}", status, body);
        }

        Ok(resp.bytes().await?.to_vec())
    }

    /// List objects and common prefixes under a prefix.
    pub async fn list_objects(
        &self,
        prefix: Option<&str>,
        delimiter: Option<&str>,
        continuation_token: Option<&str>,
        max_keys: Option<u32>,
    ) -> Result<ListObjectsResult> {
        let prefix = prefix.unwrap_or("");
        let delimiter = delimiter.unwrap_or("/");
        let max_keys = max_keys.unwrap_or(200).clamp(1, 1000);

        let mut params = vec![
            ("delimiter".to_string(), delimiter.to_string()),
            ("list-type".to_string(), "2".to_string()),
            ("max-keys".to_string(), max_keys.to_string()),
        ];
        if !prefix.is_empty() {
            params.push(("prefix".to_string(), prefix.to_string()));
        }
        if let Some(token) = continuation_token.filter(|token| !token.is_empty()) {
            params.push(("continuation-token".to_string(), token.to_string()));
        }
        params.sort_by(|a, b| a.0.cmp(&b.0));

        let query = build_query(&params);
        let date = sign::http_date();
        // Bucket listing signs the bucket resource itself; list query params are not included
        // in the OSS V1 canonicalized resource string.
        let resource = format!("/{}/", self.config.bucket);

        let signature = sign::sign_v1(
            &self.config.access_key_secret,
            "GET",
            "",
            "",
            &date,
            "",
            &resource,
        );

        let url = format!("https://{}/?{}", self.bucket_host(), query);
        let resp = self
            .http
            .get(&url)
            .header(DATE, &date)
            .header(AUTHORIZATION, self.authorization(&signature))
            .send()
            .await
            .with_context(|| format!("Failed to list OSS objects for prefix: {}", prefix))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("OSS list failed ({}): {}", status, body);
        }

        let body = resp.text().await?;
        let next_continuation_token = extract_tag(&body, "NextContinuationToken");
        let is_truncated = extract_tag(&body, "IsTruncated")
            .map(|value| value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

        let prefixes = extract_blocks(&body, "CommonPrefixes")
            .into_iter()
            .filter_map(|block| extract_tag(&block, "Prefix"))
            .filter(|item_prefix| !item_prefix.is_empty())
            .map(|item_prefix| OssPrefixSummary {
                name: display_name_for_prefix(prefix, &item_prefix),
                prefix: item_prefix,
            })
            .collect();

        let objects = extract_blocks(&body, "Contents")
            .into_iter()
            .filter_map(|block| {
                let key = extract_tag(&block, "Key")?;
                if key.is_empty() || key.ends_with('/') {
                    return None;
                }

                let size = extract_tag(&block, "Size")
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(0);

                Some(OssObjectSummary {
                    name: display_name_for_key(prefix, &key),
                    url: self.public_url(&key),
                    key,
                    size,
                    last_modified: extract_tag(&block, "LastModified"),
                })
            })
            .collect();

        Ok(ListObjectsResult {
            prefix: prefix.to_string(),
            objects,
            prefixes,
            next_continuation_token,
            is_truncated,
        })
    }

    /// Add blind watermark to an image already uploaded to OSS.
    ///
    /// This calls the OSS image processing API:
    ///   POST /{object}?x-oss-process
    ///   x-oss-process=image/blindwatermark,content_{base64},s_{strength},q_{quality}|sys/saveas,b_{bucket_base64},o_{output_key_base64}
    ///
    /// The watermarked image is saved as a new object (output_key).
    pub async fn add_blind_watermark(
        &self,
        source_key: &str,
        output_key: &str,
        watermark_text: &str,
        strength: &str,
        quality: Option<u8>,
    ) -> Result<String> {
        let content_b64 = sign::url_safe_base64_encode(watermark_text);
        let bucket_b64 = sign::url_safe_base64_encode(&self.config.bucket);
        let output_b64 = sign::url_safe_base64_encode(output_key);

        let mut process = format!(
            "image/blindwatermark,content_{},s_{}",
            content_b64, strength
        );
        if let Some(q) = quality {
            process.push_str(&format!(",q_{}", q));
        }
        process.push_str(&format!("|sys/saveas,b_{},o_{}", bucket_b64, output_b64));

        let date = sign::http_date();
        let resource = format!(
            "/{}/{}?x-oss-process",
            self.config.bucket, source_key
        );

        let signature = sign::sign_v1(
            &self.config.access_key_secret,
            "POST",
            "",
            "",
            &date,
            "",
            &resource,
        );

        let url = format!(
            "https://{}/{}?x-oss-process",
            self.bucket_host(),
            source_key
        );

        let resp = self
            .http
            .post(&url)
            .header(DATE, &date)
            .header(AUTHORIZATION, self.authorization(&signature))
            .body(format!("x-oss-process={}", process))
            .send()
            .await
            .with_context(|| "Failed to add blind watermark")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Blind watermark failed ({}): {}", status, body);
        }

        Ok(output_key.to_string())
    }

    /// Decode (extract) blind watermark from an image on OSS.
    ///
    /// This is an **async** operation via `x-oss-async-process`:
    ///   POST /{object}?x-oss-async-process
    ///   x-oss-async-process=image/deblindwatermark,s_{strength},t_text|sys/notify,topic_{base64_topic}
    ///
    /// Returns (task_id, request_id). The actual watermark content is delivered
    /// via MNS notification to the specified topic.
    pub async fn decode_blind_watermark(
        &self,
        source_key: &str,
        strength: &str,
        notify_topic: &str,
    ) -> Result<DecodeWatermarkResult> {
        let topic_b64 = sign::url_safe_base64_encode(notify_topic);
        let process = format!(
            "image/deblindwatermark,s_{},t_text|sys/notify,topic_{}",
            strength, topic_b64
        );

        let date = sign::http_date();
        let resource = format!(
            "/{}/{}?x-oss-async-process",
            self.config.bucket, source_key
        );

        let signature = sign::sign_v1(
            &self.config.access_key_secret,
            "POST",
            "",
            "",
            &date,
            "",
            &resource,
        );

        let url = format!(
            "https://{}/{}?x-oss-async-process",
            self.bucket_host(),
            source_key
        );

        let resp = self
            .http
            .post(&url)
            .header(DATE, &date)
            .header(AUTHORIZATION, self.authorization(&signature))
            .body(format!("x-oss-async-process={}", process))
            .send()
            .await
            .with_context(|| "Failed to decode blind watermark")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Decode blind watermark failed ({}): {}", status, body);
        }

        let body = resp.text().await?;
        let parsed: serde_json::Value =
            serde_json::from_str(&body).unwrap_or(serde_json::json!({"raw": body}));

        Ok(DecodeWatermarkResult {
            task_id: parsed["TaskId"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            request_id: parsed["RequestId"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            raw_response: body,
        })
    }

    /// Copy an object within the same bucket (used for rename).
    pub async fn copy_object(&self, source_key: &str, dest_key: &str) -> Result<()> {
        let date = sign::http_date();
        let resource = self.canonicalized_resource(dest_key);
        let copy_source = format!("/{}/{}", self.config.bucket, source_key);

        let oss_headers = format!("x-oss-copy-source:{}\n", copy_source);
        let signature = sign::sign_v1(
            &self.config.access_key_secret,
            "PUT",
            "",
            "",
            &date,
            &oss_headers,
            &resource,
        );

        let url = self.object_url(dest_key);
        let resp = self
            .http
            .put(&url)
            .header(DATE, &date)
            .header("x-oss-copy-source", &copy_source)
            .header(AUTHORIZATION, self.authorization(&signature))
            .send()
            .await
            .with_context(|| format!("Failed to copy OSS object: {} -> {}", source_key, dest_key))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("OSS copy failed ({}): {}", status, body);
        }

        Ok(())
    }

    /// Delete an object from OSS (for cleanup of temp files).
    pub async fn delete(&self, object_key: &str) -> Result<()> {
        let date = sign::http_date();
        let resource = self.canonicalized_resource(object_key);

        let signature = sign::sign_v1(
            &self.config.access_key_secret,
            "DELETE",
            "",
            "",
            &date,
            "",
            &resource,
        );

        let url = self.object_url(object_key);
        let resp = self
            .http
            .delete(&url)
            .header(DATE, &date)
            .header(AUTHORIZATION, self.authorization(&signature))
            .send()
            .await
            .with_context(|| format!("Failed to delete from OSS: {}", object_key))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("OSS delete failed ({}): {}", status, body);
        }

        Ok(())
    }
}

fn build_query(params: &[(String, String)]) -> String {
    params
        .iter()
        .map(|(key, value)| format!("{}={}", urlencoding(key), urlencoding(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn display_name_for_key(current_prefix: &str, key: &str) -> String {
    let relative = key.strip_prefix(current_prefix).unwrap_or(key);
    relative
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(relative)
        .to_string()
}

fn display_name_for_prefix(current_prefix: &str, prefix: &str) -> String {
    let relative = prefix.strip_prefix(current_prefix).unwrap_or(prefix);
    relative
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(relative)
        .to_string()
}

fn extract_blocks(xml: &str, tag: &str) -> Vec<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let mut out = Vec::new();
    let mut start = 0;

    while let Some(open_pos) = xml[start..].find(&open) {
        let content_start = start + open_pos + open.len();
        if let Some(close_pos) = xml[content_start..].find(&close) {
            let end = content_start + close_pos;
            out.push(xml[content_start..end].to_string());
            start = end + close.len();
        } else {
            break;
        }
    }

    out
}

fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml_unescape(&xml[start..end]))
}

fn xml_unescape(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Guess MIME type from file extension.
fn mime_from_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg".to_string(),
        Some("png") => "image/png".to_string(),
        Some("webp") => "image/webp".to_string(),
        Some("bmp") => "image/bmp".to_string(),
        Some("tiff" | "tif") => "image/tiff".to_string(),
        Some("gif") => "image/gif".to_string(),
        Some("avif") => "image/avif".to_string(),
        Some("svg") => "image/svg+xml".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}
