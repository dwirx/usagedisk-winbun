use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::analysis::{build_scan_assessment, can_auto_clean};
use crate::catalog::{target_by_id, targets};
use crate::types::{
    AvailabilityStatus, CleanResult, CleanVerificationStatus, DiskInfo, OpenFolderResult,
    ScanMode, ScannedTarget, Target,
};

struct SizeScanResult {
    size: u64,
    files: u64,
    skipped_items: u64,
}

struct DeleteResult {
    deleted: u64,
    freed: u64,
    errors: Vec<String>,
}

fn parse_disk_info_from_csv(output: &str) -> Option<DiskInfo> {
    let line = output
        .lines()
        .map(str::trim)
        .find(|line| line.contains(',') && !line.to_ascii_lowercase().contains("freespace"))?;

    let mut parts = line.split(',');
    let _node = parts.next()?;
    let free = parts.next()?.trim().parse::<u64>().ok()?;
    let total = parts.next()?.trim().parse::<u64>().ok()?;
    if total == 0 {
        return None;
    }

    Some(DiskInfo {
        total,
        free,
        used: total.saturating_sub(free),
    })
}

fn get_dir_size_and_count(dir_path: &Path) -> SizeScanResult {
    let mut size = 0;
    let mut files = 0;
    let mut skipped_items = 0;

    let entries = match fs::read_dir(dir_path) {
        Ok(entries) => entries,
        Err(_) => {
            return SizeScanResult {
                size,
                files,
                skipped_items: 1,
            };
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                skipped_items += 1;
                continue;
            }
        };
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => {
                skipped_items += 1;
                continue;
            }
        };

        if file_type.is_symlink() {
            skipped_items += 1;
            continue;
        }

        if file_type.is_dir() {
            let result = get_dir_size_and_count(&path);
            size += result.size;
            files += result.files;
            skipped_items += result.skipped_items;
            continue;
        }

        match entry.metadata() {
            Ok(metadata) => {
                size += metadata.len();
                files += 1;
            }
            Err(_) => skipped_items += 1,
        }
    }

    SizeScanResult {
        size,
        files,
        skipped_items,
    }
}

fn delete_path(path: &Path) -> DeleteResult {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return DeleteResult {
                deleted: 0,
                freed: 0,
                errors: vec![error.to_string()],
            };
        }
    };

    if metadata.is_dir() {
        let mut deleted = 0;
        let mut freed = 0;
        let mut errors = Vec::new();

        match fs::read_dir(path) {
            Ok(entries) => {
                for entry in entries {
                    let entry = match entry {
                        Ok(entry) => entry,
                        Err(error) => {
                            errors.push(error.to_string());
                            continue;
                        }
                    };
                    let result = delete_path(&entry.path());
                    deleted += result.deleted;
                    freed += result.freed;
                    errors.extend(result.errors);
                }
            }
            Err(error) => errors.push(error.to_string()),
        }

        if let Err(error) = fs::remove_dir(path) {
            errors.push(error.to_string());
        }

        return DeleteResult {
            deleted,
            freed,
            errors,
        };
    }

    let file_size = metadata.len();
    match fs::remove_file(path) {
        Ok(_) => DeleteResult {
            deleted: 1,
            freed: file_size,
            errors: Vec::new(),
        },
        Err(error) => DeleteResult {
            deleted: 0,
            freed: 0,
            errors: vec![error.to_string()],
        },
    }
}

fn delete_dir_contents(dir_path: &Path) -> DeleteResult {
    let mut deleted = 0;
    let mut freed = 0;
    let mut errors = Vec::new();

    let entries = match fs::read_dir(dir_path) {
        Ok(entries) => entries,
        Err(error) => {
            return DeleteResult {
                deleted,
                freed,
                errors: vec![error.to_string()],
            };
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                errors.push(error.to_string());
                continue;
            }
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let result = delete_path(&entry.path());
        deleted += result.deleted;
        freed += result.freed;
        if result.errors.is_empty() {
            continue;
        }
        for error in result.errors {
            errors.push(format!("{name}: {error}"));
        }
    }

    DeleteResult {
        deleted,
        freed,
        errors,
    }
}

fn build_scanned_target(
    target: Target,
    availability_status: AvailabilityStatus,
    size: u64,
    files: u64,
    skipped_items: u64,
    scan_note: Option<String>,
) -> ScannedTarget {
    let assessment = build_scan_assessment(
        availability_status.clone(),
        target.safe_to_delete.clone(),
        skipped_items,
        size,
        files,
    );

    ScannedTarget {
        target,
        size,
        files,
        skipped_items,
        availability_status,
        scan_note,
        is_estimate: false,
        deep_scan_completed: true,
        scan_mode_used: ScanMode::Deep,
        recommendation: assessment.recommendation,
        risk_level: assessment.risk_level,
        reason: assessment.reason,
        evidence: assessment.evidence,
    }
}

fn scan_target_impl(target: Target) -> ScannedTarget {
    let path = PathBuf::from(&target.path);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) => {
            if error.kind() == std::io::ErrorKind::NotFound {
                return build_scanned_target(
                    target,
                    AvailabilityStatus::Missing,
                    0,
                    0,
                    0,
                    Some("Folder tidak ditemukan di mesin ini.".to_string()),
                );
            }
            return build_scanned_target(
                target,
                AvailabilityStatus::Inaccessible,
                0,
                0,
                0,
                Some(format!("Folder ada, tetapi tidak dapat diakses: {}", error)),
            );
        }
    };

    if !metadata.is_dir() {
        return build_scanned_target(
            target,
            AvailabilityStatus::Inaccessible,
            0,
            0,
            0,
            Some("Folder ada, tetapi path bukan direktori.".to_string()),
        );
    }

    let result = get_dir_size_and_count(&path);
    let scan_note = if result.skipped_items > 0 {
        Some(format!(
            "{} item tidak bisa diakses saat pemindaian.",
            result.skipped_items
        ))
    } else {
        None
    };

    build_scanned_target(
        target,
        AvailabilityStatus::Available,
        result.size,
        result.files,
        result.skipped_items,
        scan_note,
    )
}

fn build_blocked_clean_result(
    target: &Target,
    message: String,
    estimated_bytes: u64,
    remaining_bytes: u64,
) -> CleanResult {
    CleanResult {
        id: target.id.clone(),
        name: target.name.clone(),
        success: false,
        freed_bytes: 0,
        deleted_files: 0,
        errors: vec![message.clone()],
        estimated_bytes,
        remaining_bytes,
        verification_status: CleanVerificationStatus::Blocked,
        verification_note: message,
    }
}

fn clean_target_impl(target: Target) -> CleanResult {
    let before_scan = scan_target_impl(target.clone());
    if !can_auto_clean(&before_scan.recommendation) {
        return build_blocked_clean_result(
            &target,
            before_scan.reason,
            before_scan.size,
            before_scan.size,
        );
    }

    let delete_result = delete_dir_contents(Path::new(&target.path));
    let after_scan = scan_target_impl(target.clone());
    let verification_status = if after_scan.availability_status == AvailabilityStatus::Available
        && after_scan.size == 0
    {
        CleanVerificationStatus::Verified
    } else {
        CleanVerificationStatus::Partial
    };

    let verification_note = if matches!(verification_status, CleanVerificationStatus::Verified) {
        "Preflight dan verifikasi pasca-clean lolos."
    } else {
        "Sebagian data masih tersisa atau tidak bisa diverifikasi penuh setelah clean."
    };

    CleanResult {
        id: target.id,
        name: target.name,
        success: matches!(verification_status, CleanVerificationStatus::Verified),
        freed_bytes: delete_result.freed,
        deleted_files: delete_result.deleted,
        errors: delete_result.errors,
        estimated_bytes: before_scan.size,
        remaining_bytes: after_scan.size,
        verification_status,
        verification_note: verification_note.to_string(),
    }
}

#[tauri::command]
pub fn get_targets() -> Vec<Target> {
    targets().to_vec()
}

#[tauri::command]
pub fn get_disk_info() -> DiskInfo {
    let output = Command::new("cmd")
        .args([
            "/C",
            "wmic logicaldisk where \"DeviceID='C:'\" get Size,FreeSpace /format:csv",
        ])
        .output();

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(info) = parse_disk_info_from_csv(&stdout) {
            return info;
        }
    }

    DiskInfo {
        total: 0,
        free: 0,
        used: 0,
    }
}

#[tauri::command]
pub fn scan_target(id: String) -> Result<ScannedTarget, String> {
    let target = target_by_id(&id).ok_or_else(|| "target tidak ditemukan".to_string())?;
    Ok(scan_target_impl(target))
}

#[tauri::command]
pub fn clean_target(id: String) -> Result<CleanResult, String> {
    let target = target_by_id(&id).ok_or_else(|| "target tidak ditemukan".to_string())?;
    Ok(clean_target_impl(target))
}

#[tauri::command]
pub fn open_target_folder(id: String) -> Result<OpenFolderResult, String> {
    let target = target_by_id(&id).ok_or_else(|| "target tidak ditemukan".to_string())?;
    let path = PathBuf::from(&target.path);

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_dir() {
        return Ok(OpenFolderResult {
            opened: false,
            message: "Path target bukan folder.".to_string(),
            path: target.path,
        });
    }

    let result = Command::new("explorer").arg(&target.path).spawn();
    match result {
        Ok(_) => Ok(OpenFolderResult {
            opened: true,
            message: "Folder berhasil dibuka di File Explorer.".to_string(),
            path: target.path,
        }),
        Err(error) => Ok(OpenFolderResult {
            opened: false,
            message: error.to_string(),
            path: target.path,
        }),
    }
}
