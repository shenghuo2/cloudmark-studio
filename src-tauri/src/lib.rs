mod commands;
pub mod config;
pub mod imaging;
pub mod imm;
pub mod oss;
pub mod watermark;

use commands::AppState;
use config::AppConfig;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    eprintln!("[CloudMark] Starting app...");
    let app_config = AppConfig::load().unwrap_or_default();
    eprintln!("[CloudMark] Config loaded");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            config: Mutex::new(app_config),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_oss_config,
            commands::save_watermark_config,
            commands::upload_to_oss,
            commands::add_watermark,
            commands::download_from_oss,
            commands::delete_from_oss,
            commands::decode_watermark,
            commands::get_decode_result,
            commands::get_image_info,
            commands::compress_image,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
