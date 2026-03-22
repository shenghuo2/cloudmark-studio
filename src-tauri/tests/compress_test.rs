use app_lib::imaging::compress::{compress_image, get_image_info, CompressOptions};

const TEST_IMAGE: &str = "tests/An_anime-style_girl_with_long_turquoise-cyan_hair_-1774109835021.png";

#[test]
fn test_get_image_info() {
    let info = get_image_info(TEST_IMAGE).expect("should read image info");
    println!("Image info: {:?}", info);
    assert!(info.width > 0);
    assert!(info.height > 0);
    assert!(info.file_size > 0);
}

#[test]
fn test_compress_jpeg() {
    println!("=== JPEG compression ===");
    let result = compress_image(
        TEST_IMAGE,
        Some("/tmp/cloudmark-test"),
        &CompressOptions {
            format: "jpeg".to_string(),
            quality: 80,
            ..Default::default()
        },
    )
    .expect("jpeg compression should work");
    println!("JPEG result: {:?}", result);
    assert!(result.compressed_size > 0);
}

#[test]
fn test_compress_png() {
    println!("=== PNG compression ===");
    let result = compress_image(
        TEST_IMAGE,
        Some("/tmp/cloudmark-test"),
        &CompressOptions {
            format: "png".to_string(),
            quality: 80,
            png_level: Some(2),
            ..Default::default()
        },
    )
    .expect("png compression should work");
    println!("PNG result: {:?}", result);
    assert!(result.compressed_size > 0);
}

#[test]
fn test_compress_webp() {
    println!("=== WebP compression ===");
    let result = compress_image(
        TEST_IMAGE,
        Some("/tmp/cloudmark-test"),
        &CompressOptions {
            format: "webp".to_string(),
            quality: 80,
            ..Default::default()
        },
    )
    .expect("webp compression should work");
    println!("WebP result: {:?}", result);
    assert!(result.compressed_size > 0);
}

#[test]
fn test_compress_original() {
    println!("=== Original format compression ===");
    let result = compress_image(
        TEST_IMAGE,
        Some("/tmp/cloudmark-test"),
        &CompressOptions {
            format: "original".to_string(),
            quality: 80,
            png_level: Some(2),
            ..Default::default()
        },
    )
    .expect("original format compression should work");
    println!("Original result: {:?}", result);
    assert!(result.compressed_size > 0);
}
