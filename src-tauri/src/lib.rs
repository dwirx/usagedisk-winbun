mod analysis;
mod catalog;
mod commands;
mod scan_jobs;
mod types;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(scan_jobs::ScanManager::default())
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
        .invoke_handler(tauri::generate_handler![
            scan_jobs::cancel_scan,
            scan_jobs::start_scan,
            commands::clean_target,
            commands::get_disk_info,
            commands::get_targets,
            commands::open_target_folder,
            commands::scan_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
