mod analysis;
mod catalog;
mod commands;
mod drive_analysis;
mod scan_jobs;
mod types;
mod wiztree;

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
            commands::download_wiztree,
            commands::get_disk_info,
            commands::get_targets,
            commands::get_wiztree_status,
            commands::open_path,
            commands::open_target_folder,
            commands::pick_wiztree_exe,
            commands::scan_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
