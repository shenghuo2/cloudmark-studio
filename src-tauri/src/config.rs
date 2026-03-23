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

fn default_rename_template() -> String {
    "{date}-{name}-watermarked-{n}".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatermarkConfig {
    pub content: String,
    /// low | medium | high
    pub strength: String,
    /// 70-100, only for JPEG output
    pub quality: Option<u8>,
    /// Whether to apply rename template to watermarked output
    #[serde(default)]
    pub rename_template_enabled: bool,
    /// File name template for watermarked output, e.g. {date}-{name}-watermarked-{n}
    #[serde(default = "default_rename_template")]
    pub rename_template: String,
}

impl Default for WatermarkConfig {
    fn default() -> Self {
        Self {
            content: String::new(),
            strength: "low".to_string(),
            quality: Some(90),
            rename_template_enabled: false,
            rename_template: default_rename_template(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressConfig {
    /// Whether to auto-save compressed result next to the original file
    pub auto_save: bool,
}

impl Default for CompressConfig {
    fn default() -> Self {
        Self { auto_save: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodeConfig {
    /// Whether to auto-delete OSS file after decode completes
    pub auto_delete: bool,
}

impl Default for DecodeConfig {
    fn default() -> Self {
        Self { auto_delete: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub oss: Option<OssConfig>,
    pub watermark: WatermarkConfig,
    #[serde(default)]
    pub compress: CompressConfig,
    #[serde(default)]
    pub decode: DecodeConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            oss: None,
            watermark: WatermarkConfig::default(),
            compress: CompressConfig::default(),
            decode: DecodeConfig::default(),
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
