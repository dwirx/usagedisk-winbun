use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::analysis::build_scan_assessment;
use crate::catalog::targets;
use crate::types::{
    AdvisoryFinding, AvailabilityStatus, RiskLevel, ScanJobEvent, ScanJobSummary, ScanMode,
    ScanPhase, ScannedTarget, SafeLevel, Target,
};

const ADAPTIVE_DEEP_THRESHOLD_BYTES: u64 = 64 * 1024 * 1024;
const SCAN_EVENT_NAME: &str = "scan://event";

#[derive(Clone, Default)]
pub struct ScanManager {
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

struct SizeScanResult {
    size: u64,
    files: u64,
    skipped_items: u64,
}

struct QuickProbeResult {
    size: u64,
    files: u64,
    skipped_items: u64,
    has_subdirs: bool,
}

fn is_cancelled(cancel_flag: &AtomicBool) -> bool {
    cancel_flag.load(Ordering::Relaxed)
}

fn quick_probe_dir(dir_path: &Path) -> QuickProbeResult {
    let mut result = QuickProbeResult {
        size: 0,
        files: 0,
        skipped_items: 0,
        has_subdirs: false,
    };

    let entries = match fs::read_dir(dir_path) {
        Ok(entries) => entries,
        Err(_) => {
            result.skipped_items = 1;
            return result;
        }
    };

    for entry in entries {
        let Ok(entry) = entry else {
            result.skipped_items += 1;
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            result.skipped_items += 1;
            continue;
        };
        if file_type.is_symlink() {
            result.skipped_items += 1;
            continue;
        }
        if file_type.is_dir() {
            result.has_subdirs = true;
            continue;
        }
        match entry.metadata() {
            Ok(metadata) => {
                result.size += metadata.len();
                result.files += 1;
            }
            Err(_) => result.skipped_items += 1,
        }
    }

    result
}

fn get_dir_size_and_count(dir_path: &Path, cancel_flag: &AtomicBool) -> SizeScanResult {
    if is_cancelled(cancel_flag) {
        return SizeScanResult {
            size: 0,
            files: 0,
            skipped_items: 0,
        };
    }

    let mut result = SizeScanResult {
        size: 0,
        files: 0,
        skipped_items: 0,
    };

    let entries = match fs::read_dir(dir_path) {
        Ok(entries) => entries,
        Err(_) => {
            result.skipped_items = 1;
            return result;
        }
    };

    for entry in entries {
        if is_cancelled(cancel_flag) {
            break;
        }

        let Ok(entry) = entry else {
            result.skipped_items += 1;
            continue;
        };
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            result.skipped_items += 1;
            continue;
        };

        if file_type.is_symlink() {
            result.skipped_items += 1;
            continue;
        }
        if file_type.is_dir() {
            let sub = get_dir_size_and_count(&path, cancel_flag);
            result.size += sub.size;
            result.files += sub.files;
            result.skipped_items += sub.skipped_items;
            continue;
        }
        match entry.metadata() {
            Ok(metadata) => {
                result.size += metadata.len();
                result.files += 1;
            }
            Err(_) => result.skipped_items += 1,
        }
    }

    result
}

fn build_scanned_target(
    target: Target,
    availability_status: AvailabilityStatus,
    size: u64,
    files: u64,
    skipped_items: u64,
    scan_note: Option<String>,
    is_estimate: bool,
    deep_scan_completed: bool,
    scan_mode_used: ScanMode,
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
        is_estimate,
        deep_scan_completed,
        scan_mode_used,
        recommendation: assessment.recommendation,
        risk_level: assessment.risk_level,
        reason: assessment.reason,
        evidence: assessment.evidence,
    }
}

fn quick_scan_target(target: Target, mode: ScanMode) -> (ScannedTarget, bool) {
    let path = PathBuf::from(&target.path);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) => {
            let unavailable = if error.kind() == std::io::ErrorKind::NotFound {
                AvailabilityStatus::Missing
            } else {
                AvailabilityStatus::Inaccessible
            };
            return (
                build_scanned_target(
                    target,
                    unavailable,
                    0,
                    0,
                    0,
                    Some(error.to_string()),
                    false,
                    false,
                    mode,
                ),
                false,
            );
        }
    };

    if !metadata.is_dir() {
        return (
            build_scanned_target(
                target,
                AvailabilityStatus::Inaccessible,
                0,
                0,
                0,
                Some("Path target bukan direktori.".to_string()),
                false,
                false,
                mode,
            ),
            false,
        );
    }

    let probe = quick_probe_dir(&path);
    let needs_deep = match mode {
        ScanMode::Quick => false,
        ScanMode::Deep => true,
        ScanMode::Adaptive => {
            probe.has_subdirs
                || probe.size >= ADAPTIVE_DEEP_THRESHOLD_BYTES
                || probe.skipped_items > 0
                || target.safe_to_delete != SafeLevel::Safe
        }
    };

    (
        build_scanned_target(
            target,
            AvailabilityStatus::Available,
            probe.size,
            probe.files,
            probe.skipped_items,
            if needs_deep {
                Some("Estimasi cepat selesai. Deep scan menyusul.".to_string())
            } else {
                None
            },
            needs_deep,
            !needs_deep,
            mode,
        ),
        needs_deep,
    )
}

fn deep_scan_target(target: Target, cancel_flag: &AtomicBool, mode: ScanMode) -> ScannedTarget {
    let path = PathBuf::from(&target.path);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) => {
            let unavailable = if error.kind() == std::io::ErrorKind::NotFound {
                AvailabilityStatus::Missing
            } else {
                AvailabilityStatus::Inaccessible
            };
            return build_scanned_target(
                target,
                unavailable,
                0,
                0,
                0,
                Some(error.to_string()),
                false,
                true,
                mode,
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
            Some("Path target bukan direktori.".to_string()),
            false,
            true,
            mode,
        );
    }

    let deep = get_dir_size_and_count(&path, cancel_flag);
    build_scanned_target(
        target,
        AvailabilityStatus::Available,
        deep.size,
        deep.files,
        deep.skipped_items,
        None,
        false,
        true,
        mode,
    )
}

fn size_of_existing_path(path: &Path, is_dir: bool, cancel_flag: &AtomicBool) -> Option<u64> {
    if is_dir {
        fs::metadata(path)
            .ok()
            .filter(|metadata| metadata.is_dir())
            .map(|_| get_dir_size_and_count(path, cancel_flag).size)
    } else {
        fs::metadata(path)
            .ok()
            .filter(|metadata| metadata.is_file())
            .map(|metadata| metadata.len())
    }
}

fn push_advisory_if_present(
    findings: &mut Vec<AdvisoryFinding>,
    cancel_flag: &AtomicBool,
    id: &str,
    name: &str,
    category: &str,
    raw_path: &str,
    severity: RiskLevel,
    reason: &str,
    action: &str,
    is_dir: bool,
) {
    if is_cancelled(cancel_flag) {
        return;
    }

    let path = Path::new(raw_path);
    let Some(size) = size_of_existing_path(path, is_dir, cancel_flag) else {
        return;
    };
    if size == 0 {
        return;
    }

    findings.push(AdvisoryFinding {
        id: id.to_string(),
        name: name.to_string(),
        category: category.to_string(),
        severity,
        size,
        reason: reason.to_string(),
        suggested_action: action.to_string(),
        path: Some(raw_path.to_string()),
        scan_note: None,
    });
}

fn detect_virtual_disk_advisories(
    findings: &mut Vec<AdvisoryFinding>,
    cancel_flag: &AtomicBool,
) {
    let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let local_app_data = PathBuf::from(local_app_data);

    let docker_vhdx = local_app_data
        .join("Docker")
        .join("wsl")
        .join("data")
        .join("ext4.vhdx");
    if let Some(size) = size_of_existing_path(&docker_vhdx, false, cancel_flag) {
        findings.push(AdvisoryFinding {
            id: "docker_desktop_vhdx".to_string(),
            name: "Docker Desktop VHDX".to_string(),
            category: "Virtual Disk".to_string(),
            severity: RiskLevel::High,
            size,
            reason: "Image disk Docker Desktop untuk WSL dapat tumbuh sangat besar.".to_string(),
            suggested_action:
                "Prune image/container/volume Docker lalu compact VHDX bila perlu."
                    .to_string(),
            path: Some(docker_vhdx.display().to_string()),
            scan_note: None,
        });
    }

    let packages_dir = local_app_data.join("Packages");
    let entries = match fs::read_dir(&packages_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries {
        if is_cancelled(cancel_flag) {
            break;
        }

        let Ok(entry) = entry else {
            continue;
        };
        let ext4_vhdx = entry.path().join("LocalState").join("ext4.vhdx");
        let Some(size) = size_of_existing_path(&ext4_vhdx, false, cancel_flag) else {
            continue;
        };
        findings.push(AdvisoryFinding {
            id: format!("package_vhdx_{}", findings.len()),
            name: format!(
                "WSL/App Virtual Disk ({})",
                entry.file_name().to_string_lossy()
            ),
            category: "Virtual Disk".to_string(),
            severity: RiskLevel::High,
            size,
            reason: "Disk virtual aplikasi atau distro Linux dapat memakan ruang puluhan GB."
                .to_string(),
            suggested_action:
                "Tinjau distro/app terkait dan compact atau hapus data yang tidak diperlukan."
                    .to_string(),
            path: Some(ext4_vhdx.display().to_string()),
            scan_note: None,
        });
    }
}

fn detect_advisories(cancel_flag: &AtomicBool) -> Vec<AdvisoryFinding> {
    let mut findings = Vec::new();

    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "hiberfil_sys",
        "Hibernate File",
        "System Advisory",
        "C:\\hiberfil.sys",
        RiskLevel::High,
        "File hibernasi Windows dapat memakan ruang beberapa GB.",
        "Jika tidak butuh Hibernate/Fast Startup, nonaktifkan dengan `powercfg /h off`.",
        false,
    );
    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "pagefile_sys",
        "Page File",
        "System Advisory",
        "C:\\pagefile.sys",
        RiskLevel::Medium,
        "Virtual memory Windows bisa sangat besar.",
        "Tinjau pengaturan virtual memory, jangan hapus manual.",
        false,
    );
    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "windows_old",
        "Windows.old",
        "System Advisory",
        "C:\\Windows.old",
        RiskLevel::High,
        "Sisa instalasi Windows lama sering sangat besar.",
        "Gunakan Storage Sense atau Disk Cleanup untuk menghapusnya.",
        true,
    );
    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "memory_dmp",
        "MEMORY.DMP",
        "Crash Dump",
        "C:\\Windows\\MEMORY.DMP",
        RiskLevel::Medium,
        "Dump memori penuh setelah BSOD dapat sangat besar.",
        "Hapus jika Anda tidak sedang analisis crash.",
        false,
    );
    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "windows_minidump",
        "Windows Minidump",
        "Crash Dump",
        "C:\\Windows\\Minidump",
        RiskLevel::Low,
        "File minidump crash menumpuk seiring waktu.",
        "Aman dihapus bila tidak sedang troubleshooting BSOD.",
        true,
    );
    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "delivery_optimization_cache",
        "Delivery Optimization Cache",
        "Windows Cache",
        "C:\\ProgramData\\Microsoft\\Windows\\DeliveryOptimization\\Cache",
        RiskLevel::Low,
        "Cache distribusi update Windows dapat tumbuh besar pada beberapa mesin.",
        "Aman dibersihkan bila update sudah selesai.",
        true,
    );
    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "cbs_logs",
        "CBS Logs",
        "Windows Logs",
        "C:\\Windows\\Logs\\CBS",
        RiskLevel::Low,
        "Log servicing Windows bisa membengkak setelah banyak update.",
        "Tinjau dan hapus log lama bila tidak sedang troubleshooting update.",
        true,
    );
    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "dism_logs",
        "DISM Logs",
        "Windows Logs",
        "C:\\Windows\\Logs\\DISM",
        RiskLevel::Low,
        "Log DISM bisa menumpuk pada perangkat yang sering diperbaiki atau di-image.",
        "Aman dibersihkan jika tidak sedang mendiagnosis servicing Windows.",
        true,
    );
    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "panther_logs",
        "Panther Logs",
        "Windows Logs",
        "C:\\Windows\\Panther",
        RiskLevel::Low,
        "Log instalasi dan upgrade Windows sering tertinggal setelah upgrade besar.",
        "Tinjau log lama pasca-upgrade Windows.",
        true,
    );
    push_advisory_if_present(
        &mut findings,
        cancel_flag,
        "defender_history",
        "Defender Scan History",
        "Security Logs",
        "C:\\ProgramData\\Microsoft\\Windows Defender\\Scans\\History",
        RiskLevel::Low,
        "Riwayat scan Microsoft Defender dapat menyimpan banyak artefak lama.",
        "Tinjau dan bersihkan histori scan lama bila tidak dibutuhkan.",
        true,
    );
    detect_virtual_disk_advisories(&mut findings, cancel_flag);

    findings
}

fn summary_of(results: &HashMap<String, ScannedTarget>, advisories: usize) -> ScanJobSummary {
    ScanJobSummary {
        checked: results.len(),
        found: results.values().filter(|item| item.size > 0).count(),
        missing: results.values().filter(|item| item.availability_status == AvailabilityStatus::Missing).count(),
        inaccessible: results.values().filter(|item| item.availability_status == AvailabilityStatus::Inaccessible).count(),
        skipped_items: results.values().map(|item| item.skipped_items).sum(),
        advisories,
    }
}

fn emit(app: &AppHandle, event: ScanJobEvent) {
    let _ = app.emit(SCAN_EVENT_NAME, event);
}

#[tauri::command]
pub fn start_scan(app: AppHandle, state: State<'_, ScanManager>, mode: ScanMode) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state.jobs.lock().map_err(|_| "scan manager lock gagal".to_string())?.insert(job_id.clone(), cancel_flag.clone());

    let jobs = state.jobs.clone();
    let app_handle = app.clone();
    let job_id_for_task = job_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target_list = targets().to_vec();
        let mut results = HashMap::<String, ScannedTarget>::new();
        let mut deep_candidates = Vec::<Target>::new();

        emit(&app_handle, ScanJobEvent { event_type: "started".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Quick), current: Some(0), total: Some(target_list.len()), label: Some("Scan dimulai".to_string()), item: None, advisory: None, summary: None, message: None });

        for (index, target) in target_list.iter().cloned().enumerate() {
            if is_cancelled(&cancel_flag) {
                emit(&app_handle, ScanJobEvent { event_type: "cancelled".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Quick), current: Some(index), total: Some(target_list.len()), label: None, item: None, advisory: None, summary: Some(summary_of(&results, 0)), message: Some("Scan dibatalkan.".to_string()) });
                if let Ok(mut jobs) = jobs.lock() { jobs.remove(&job_id_for_task); }
                return;
            }

            emit(&app_handle, ScanJobEvent { event_type: "progress".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Quick), current: Some(index + 1), total: Some(target_list.len()), label: Some(target.name.clone()), item: None, advisory: None, summary: None, message: None });
            let (quick, needs_deep) = quick_scan_target(target.clone(), mode.clone());
            results.insert(quick.target.id.clone(), quick.clone());
            if mode == ScanMode::Adaptive && needs_deep { deep_candidates.push(target); }
            emit(&app_handle, ScanJobEvent { event_type: "target".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Quick), current: None, total: None, label: None, item: Some(quick), advisory: None, summary: None, message: None });
        }

        if mode != ScanMode::Quick {
            let deep_list = if mode == ScanMode::Deep { target_list.clone() } else { deep_candidates.clone() };
            for (index, target) in deep_list.into_iter().enumerate() {
                if is_cancelled(&cancel_flag) {
                    emit(&app_handle, ScanJobEvent { event_type: "cancelled".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Deep), current: Some(index), total: Some(deep_candidates.len()), label: None, item: None, advisory: None, summary: Some(summary_of(&results, 0)), message: Some("Scan dibatalkan.".to_string()) });
                    if let Ok(mut jobs) = jobs.lock() { jobs.remove(&job_id_for_task); }
                    return;
                }
                emit(&app_handle, ScanJobEvent { event_type: "progress".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Deep), current: Some(index + 1), total: Some(if mode == ScanMode::Deep { target_list.len() } else { deep_candidates.len() }), label: Some(target.name.clone()), item: None, advisory: None, summary: None, message: None });
                let deep = deep_scan_target(target, &cancel_flag, mode.clone());
                results.insert(deep.target.id.clone(), deep.clone());
                emit(&app_handle, ScanJobEvent { event_type: "target".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Deep), current: None, total: None, label: None, item: Some(deep), advisory: None, summary: None, message: None });
            }
        }

        let advisories = detect_advisories(&cancel_flag);
        for (index, advisory) in advisories.iter().cloned().enumerate() {
            emit(&app_handle, ScanJobEvent { event_type: "progress".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Diagnostics), current: Some(index + 1), total: Some(advisories.len()), label: Some(advisory.name.clone()), item: None, advisory: None, summary: None, message: None });
            emit(&app_handle, ScanJobEvent { event_type: "advisory".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Diagnostics), current: None, total: None, label: None, item: None, advisory: Some(advisory), summary: None, message: None });
        }

        emit(&app_handle, ScanJobEvent { event_type: "done".to_string(), job_id: job_id_for_task.clone(), phase: Some(ScanPhase::Diagnostics), current: Some(results.len()), total: Some(target_list.len()), label: None, item: None, advisory: None, summary: Some(summary_of(&results, advisories.len())), message: None });
        if let Ok(mut jobs) = jobs.lock() { jobs.remove(&job_id_for_task); }
    });

    Ok(job_id)
}

#[tauri::command]
pub fn cancel_scan(job_id: String, state: State<'_, ScanManager>) -> Result<(), String> {
    let jobs = state.jobs.lock().map_err(|_| "scan manager lock gagal".to_string())?;
    let Some(cancel_flag) = jobs.get(&job_id) else {
        return Err("scan job tidak ditemukan".to_string());
    };
    cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}
