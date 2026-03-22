use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OssConfig {
    pub access_key_id: String,
    pub access_key_secret: String,
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    /// Optional path prefix for uploaded objects, e.g. "images/"
    pub path_prefix: Option<String>,
    /// Optional custom domain for generating URLs
    pub custom_domain: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatermarkConfig {
    pub content: String,
    /// low | medium | high
    pub strength: String,
    /// 70-100, only for JPEG output
    pub quality: Option<u8>,
}

impl Default for WatermarkConfig {
    fn default() -> Self {
        Self {
            content: String::new(),
            strength: "low".to_string(),
            quality: Some(90),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub oss: Option<OssConfig>,
    pub watermark: WatermarkConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            oss: None,
            watermark: WatermarkConfig::default(),
        }
    }
}

impl AppConfig {
    pub fn config_path() -> anyhow::Result<PathBuf> {
        let dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("Cannot find config directory"))?
            .join("cloudmark-studio");
        std::fs::create_dir_all(&dir)?;
        Ok(dir.join("config.json"))
    }

    pub fn load() -> anyhow::Result<Self> {
        let path = Self::config_path()?;
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = Self::config_path()?;
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, content)?;
        Ok(())
    }
}
