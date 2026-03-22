use base64::Engine;
use chrono::Utc;
use hmac::Mac;

/// Build the OSS V1 signature for a request.
/// V1 is simpler and widely supported for OSS operations.
///
/// Signature = Base64(HMAC-SHA1(AccessKeySecret, StringToSign))
///
/// StringToSign = VERB + "\n"
///              + Content-MD5 + "\n"
///              + Content-Type + "\n"
///              + Date + "\n"
///              + CanonicalizedOSSHeaders
///              + CanonicalizedResource
pub fn sign_v1(
    access_key_secret: &str,
    verb: &str,
    content_md5: &str,
    content_type: &str,
    date: &str,
    canonicalized_oss_headers: &str,
    canonicalized_resource: &str,
) -> String {
    let string_to_sign = format!(
        "{}\n{}\n{}\n{}\n{}{}",
        verb, content_md5, content_type, date, canonicalized_oss_headers, canonicalized_resource
    );

    let mut mac =
        hmac::Hmac::<sha1::Sha1>::new_from_slice(access_key_secret.as_bytes()).unwrap();
    mac.update(string_to_sign.as_bytes());
    let result = mac.finalize().into_bytes();
    base64::engine::general_purpose::STANDARD.encode(result)
}

/// Format current time as HTTP date for OSS requests.
pub fn http_date() -> String {
    Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string()
}

/// URL-safe Base64 encode (used for watermark content and sys/saveas params).
/// 1. Standard Base64 encode
/// 2. Replace '+' with '-'
/// 3. Replace '/' with '_'
/// 4. Remove trailing '='
pub fn url_safe_base64_encode(input: &str) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(input.as_bytes());
    encoded
        .replace('+', "-")
        .replace('/', "_")
        .trim_end_matches('=')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_safe_base64_encode() {
        // "阿里云版权所有" should encode to "6Zi_6YeM5LqR54mI5p2D5omA5pyJ"
        let result = url_safe_base64_encode("阿里云版权所有");
        assert_eq!(result, "6Zi_6YeM5LqR54mI5p2D5omA5pyJ");
    }
}
