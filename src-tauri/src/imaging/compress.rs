use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{DynamicImage, ImageReader};
use std::fs;
use std::panic;
use std::path::{Path, PathBuf};

const MAX_PIXELS: u64 = 50_000_000; // 50 megapixels

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CompressOptions {
    /// Output format: "jpeg", "png", "webp", "avif", or "original" (keep same format)
    pub format: String,
    /// Quality 1-100 (for lossy formats: JPEG, WebP lossy, AVIF)
    pub quality: u8,
    /// PNG optimization level 0-6 (only for PNG output, via oxipng)
    pub png_level: Option<u8>,
    /// Resize width (0 = keep original)
    pub width: Option<u32>,
    /// Resize height (0 = keep original)
    pub height: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CompressResult {
    pub output_path: String,
    pub original_size: u64,
    pub compressed_size: u64,
    pub width: u32,
    pub height: u32,
    pub format: String,
}

impl Default for CompressOptions {
    fn default() -> Self {
        Self {
            format: "original".to_string(),
            quality: 80,
            png_level: Some(2),
            width: None,
            height: None,
        }
    }
}

/// Detect format from file extension
fn detect_format(path: &Path) -> &str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => "jpeg",
        Some("png") => "png",
        Some("webp") => "webp",
        Some("avif") => "avif",
        Some("bmp") => "png",
        Some("tiff" | "tif") => "png",
        _ => "png",
    }
}

/// Get the output file extension for a format
fn format_extension(format: &str) -> &str {
    match format {
        "jpeg" => "jpg",
        "png" => "png",
        "webp" => "webp",
        "avif" => "avif",
        _ => "png",
    }
}

/// Compress a single image file.
/// Returns the output path and size information.
pub fn compress_image(
    input_path: &str,
    output_dir: Option<&str>,
    opts: &CompressOptions,
) -> anyhow::Result<CompressResult> {
    let input = Path::new(input_path);
    let original_size = fs::metadata(input)?.len();

    // Decode image then check size to prevent processing oversized images
    let img = ImageReader::open(input)?.with_guessed_format()?.decode()?;
    let (w, h) = (img.width(), img.height());
    if (w as u64) * (h as u64) > MAX_PIXELS {
        anyhow::bail!(
            "Image too large: {}x{} ({:.0}MP, max {}MP)",
            w, h,
            (w as f64 * h as f64) / 1_000_000.0,
            MAX_PIXELS / 1_000_000
        );
    }

    // Determine output format
    let out_format = if opts.format == "original" {
        detect_format(input).to_string()
    } else {
        opts.format.clone()
    };

    // Optional resize
    let img = resize_if_needed(img, opts.width, opts.height);
    let (width, height) = (img.width(), img.height());

    // Encode (with panic protection — some C-based encoders can panic)
    let fmt_clone = out_format.clone();
    let opts_clone = opts.clone();
    let encode_result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
        encode_image(&img, &fmt_clone, &opts_clone)
    }));

    let encoded = match encode_result {
        Ok(Ok(data)) => data,
        Ok(Err(e)) => anyhow::bail!("Encode error: {}", e),
        Err(_) => anyhow::bail!("Encoder crashed (panic) for format: {}", out_format),
    };

    // Write output
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let ext = format_extension(&out_format);

    let out_dir = match output_dir {
        Some(d) => PathBuf::from(d),
        None => input.parent().unwrap_or(Path::new(".")).to_path_buf(),
    };
    fs::create_dir_all(&out_dir)?;

    let output_path = out_dir.join(format!("{}_compressed.{}", stem, ext));
    fs::write(&output_path, &encoded)?;

    let compressed_size = encoded.len() as u64;

    Ok(CompressResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_size,
        compressed_size,
        width,
        height,
        format: out_format,
    })
}

fn resize_if_needed(img: DynamicImage, width: Option<u32>, height: Option<u32>) -> DynamicImage {
    let w = width.unwrap_or(0);
    let h = height.unwrap_or(0);
    if w == 0 && h == 0 {
        return img;
    }

    let (orig_w, orig_h) = (img.width(), img.height());

    let (new_w, new_h) = if w > 0 && h > 0 {
        (w, h)
    } else if w > 0 {
        let ratio = w as f64 / orig_w as f64;
        (w, (orig_h as f64 * ratio).round() as u32)
    } else {
        let ratio = h as f64 / orig_h as f64;
        ((orig_w as f64 * ratio).round() as u32, h)
    };

    img.resize(new_w, new_h, image::imageops::FilterType::Lanczos3)
}

fn encode_image(
    img: &DynamicImage,
    format: &str,
    opts: &CompressOptions,
) -> anyhow::Result<Vec<u8>> {
    match format {
        "jpeg" => encode_jpeg(img, opts.quality),
        "png" => encode_png(img, opts.png_level.unwrap_or(2)),
        "webp" => encode_webp(img, opts.quality),
        _ => anyhow::bail!("Unsupported output format: {}", format),
    }
}

fn encode_jpeg(img: &DynamicImage, quality: u8) -> anyhow::Result<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    rgb.write_with_encoder(encoder)?;
    Ok(buf)
}

fn encode_png(img: &DynamicImage, level: u8) -> anyhow::Result<Vec<u8>> {
    // First encode with image crate
    let rgba = img.to_rgba8();
    let mut buf = Vec::new();
    let encoder = PngEncoder::new(&mut buf);
    rgba.write_with_encoder(encoder)?;

    // Then optimize with oxipng
    let oxipng_level = match level {
        0 => oxipng::Options::from_preset(0),
        1 => oxipng::Options::from_preset(1),
        2 => oxipng::Options::from_preset(2),
        3 => oxipng::Options::from_preset(3),
        4 => oxipng::Options::from_preset(4),
        5 => oxipng::Options::from_preset(5),
        _ => oxipng::Options::from_preset(6),
    };

    let optimized = oxipng::optimize_from_memory(&buf, &oxipng_level)?;
    Ok(optimized)
}

fn encode_webp(img: &DynamicImage, quality: u8) -> anyhow::Result<Vec<u8>> {
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let encoder = webp::Encoder::from_rgba(rgba.as_raw(), w, h);
    let mem = encoder.encode(quality as f32);
    Ok(mem.to_vec())
}

/// Get image info without compressing (for preview/comparison)
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImageInfo {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub file_size: u64,
}

pub fn get_image_info(path: &str) -> anyhow::Result<ImageInfo> {
    let p = Path::new(path);
    let file_size = fs::metadata(p)?.len();
    let reader = ImageReader::open(p)?.with_guessed_format()?;
    let format_str = reader
        .format()
        .map(|f| format!("{:?}", f).to_lowercase())
        .unwrap_or_else(|| "unknown".to_string());
    let (width, height) = reader.into_dimensions()?;

    Ok(ImageInfo {
        width,
        height,
        format: format_str,
        file_size,
    })
}
