use crate::oss::sign::url_safe_base64_encode;

/// Encode watermark text to URL-safe Base64 format required by Alibaba Cloud OSS.
///
/// Steps:
/// 1. Standard Base64 encode
/// 2. Replace '+' with '-'
/// 3. Replace '/' with '_'
/// 4. Remove trailing '='
pub fn encode_watermark_text(text: &str) -> String {
    url_safe_base64_encode(text)
}

/// Validate watermark text constraints.
/// - Max 256 characters before Base64 encoding.
/// - Must not be empty.
pub fn validate_watermark_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("Watermark text cannot be empty".to_string());
    }
    if text.chars().count() > 256 {
        return Err(format!(
            "Watermark text too long: {} chars (max 256)",
            text.chars().count()
        ));
    }
    Ok(())
}

/// Validate watermark strength parameter.
pub fn validate_strength(strength: &str) -> Result<(), String> {
    match strength {
        "low" | "medium" | "high" => Ok(()),
        _ => Err(format!(
            "Invalid strength '{}', must be one of: low, medium, high",
            strength
        )),
    }
}

/// Validate quality parameter (only for JPEG output).
pub fn validate_quality(quality: u8) -> Result<(), String> {
    if (70..=100).contains(&quality) {
        Ok(())
    } else {
        Err(format!(
            "Invalid quality {}, must be between 70 and 100",
            quality
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_watermark() {
        let encoded = encode_watermark_text("阿里云版权所有");
        assert_eq!(encoded, "6Zi_6YeM5LqR54mI5p2D5omA5pyJ");
    }

    #[test]
    fn test_validate_empty() {
        assert!(validate_watermark_text("").is_err());
    }

    #[test]
    fn test_validate_too_long() {
        let long_text: String = "a".repeat(257);
        assert!(validate_watermark_text(&long_text).is_err());
    }

    #[test]
    fn test_validate_strength() {
        assert!(validate_strength("low").is_ok());
        assert!(validate_strength("medium").is_ok());
        assert!(validate_strength("high").is_ok());
        assert!(validate_strength("invalid").is_err());
    }

    #[test]
    fn test_validate_quality() {
        assert!(validate_quality(90).is_ok());
        assert!(validate_quality(70).is_ok());
        assert!(validate_quality(100).is_ok());
        assert!(validate_quality(69).is_err());
        assert!(validate_quality(101).is_err());
    }
}
