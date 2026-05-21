use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::types::{
    AdvisoryFinding, DriveAnalysisSummary, LargestItem, Recommendation, RiskLevel, ScanJobEvent,
    ScanPhase, ScannedTarget, StorageNode, StorageNodeType,
};

const DRIVE_ROOT: &str = "C:\\";
const LARGE_FOLDER_THRESHOLD_BYTES: u64 = 256 * 1024 * 1024;
const LARGE_FILE_THRESHOLD_BYTES: u64 = 128 * 1024 * 1024;
const MAX_CAPTURED_NODES: usize = 1600;
const MAX_LARGEST_ITEMS: usize = 140;
const DEFAULT_SHALLOW_DEPTH: u16 = 2;
const WINDOWS_DEPTH: u16 = 3;
const USERS_DEPTH: u16 = 5;
const PROGRAM_DATA_DEPTH: u16 = 4;
const CACHE_TTL_SECONDS: u64 = 300;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct DriveAnalysisCache {
    version: u8,
    saved_at: u64,
    result: DriveAnalysisResult,
}

struct RootScanPlan {
    path: PathBuf,
    max_depth: u16,
}

struct WalkStats {
    size: u64,
    file_count: u64,
    child_count: u64,
}

struct WalkState {
    nodes: Vec<StorageNode>,
    largest_files: Vec<LargestItem>,
    largest_dirs: Vec<LargestItem>,
    visited_dirs: usize,
    personal_data_bytes: u64,
    virtual_disk_bytes: u64,
    large_file_bytes: u64,
    user_roots: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DriveAnalysisResult {
    pub summary: DriveAnalysisSummary,
    pub nodes: Vec<StorageNode>,
    pub largest_items: Vec<LargestItem>,
}

impl WalkState {
    fn new() -> Self {
        Self {
            nodes: Vec::new(),
            largest_files: Vec::new(),
            largest_dirs: Vec::new(),
            visited_dirs: 0,
            personal_data_bytes: 0,
            virtual_disk_bytes: 0,
            large_file_bytes: 0,
            user_roots: build_user_roots(),
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs()
}

fn cache_path() -> Option<PathBuf> {
    let base = dirs::cache_dir()?;
    Some(base.join("usagedisk").join("drive-analysis-cache.json"))
}

pub fn load_cached_drive_analysis() -> Option<DriveAnalysisResult> {
    let cache_path = cache_path()?;
    let raw = fs::read_to_string(cache_path).ok()?;
    let cache = serde_json::from_str::<DriveAnalysisCache>(&raw).ok()?;
    if cache.version != 1 {
        return None;
    }
    let mut result = cache.result;
    result.summary.engine_used = "incremental_cache".to_string();
    result.summary.cache_state = "warm".to_string();
    result.summary.admin_acceleration = has_admin_acceleration();
    if result.summary.last_indexed_at.is_none() {
        result.summary.last_indexed_at = Some(cache.saved_at);
    }
    Some(result)
}

pub fn cache_age_seconds(summary: &DriveAnalysisSummary) -> Option<u64> {
    summary
        .last_indexed_at
        .map(|saved_at| unix_now().saturating_sub(saved_at))
}

pub fn should_refresh_cache(summary: &DriveAnalysisSummary) -> bool {
    match cache_age_seconds(summary) {
        Some(age) => age > CACHE_TTL_SECONDS,
        None => true,
    }
}

pub fn save_cached_drive_analysis(result: &DriveAnalysisResult) -> Result<(), String> {
    let Some(cache_path) = cache_path() else {
        return Err("cache directory tidak tersedia".to_string());
    };
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string(&DriveAnalysisCache {
        version: 1,
        saved_at: unix_now(),
        result: result.clone(),
    })
    .map_err(|error| error.to_string())?;

    fs::write(cache_path, payload).map_err(|error| error.to_string())
}

pub fn has_admin_acceleration() -> bool {
    let status = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ])
        .output();

    match status {
        Ok(output) => String::from_utf8_lossy(&output.stdout)
            .trim()
            .eq_ignore_ascii_case("true"),
        Err(_) => false,
    }
}

fn build_user_roots() -> Vec<String> {
    let Some(profile) = std::env::var_os("USERPROFILE") else {
        return Vec::new();
    };
    let base = PathBuf::from(profile);
    ["Desktop", "Documents", "Downloads", "Pictures", "Videos"]
        .iter()
        .map(|segment| normalize_path(&base.join(segment)))
        .collect()
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
}

fn path_id(path: &Path) -> String {
    normalize_path(path)
}

fn display_name(path: &Path, root: &Path) -> String {
    if path == root {
        return DRIVE_ROOT.to_string();
    }

    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.display().to_string())
}

fn is_virtual_disk_path(path: &Path) -> bool {
    let lower = normalize_path(path);
    lower.ends_with(".vhdx")
        || lower.ends_with(".vhd")
        || lower.ends_with(".vmdk")
        || lower.ends_with(".vdi")
        || lower.ends_with(".qcow2")
        || lower.contains("\\docker\\")
        || lower.contains("\\wsl\\")
        || lower.contains("\\virtual hard disks\\")
}

fn category_for_path(path: &Path, user_roots: &[String]) -> &'static str {
    let lower = normalize_path(path);
    if user_roots.iter().any(|prefix| lower.starts_with(prefix)) {
        return "Large Personal Data";
    }
    if is_virtual_disk_path(path) {
        return "Virtual Disk";
    }
    if lower.contains("\\windows\\") || lower.contains("\\programdata\\") {
        return "System Area";
    }
    "Large Folder"
}

fn classify_path(
    path: &Path,
    linked_target: Option<&ScannedTarget>,
    user_roots: &[String],
) -> (String, Recommendation, RiskLevel, Option<String>, bool) {
    if let Some(target) = linked_target {
        return (
            target.target.category.clone(),
            target.recommendation.clone(),
            target.risk_level.clone(),
            Some(target.target.id.clone()),
            true,
        );
    }

    let category = category_for_path(path, user_roots).to_string();
    if category == "Large Personal Data" {
        return (
            category,
            Recommendation::ReviewFirst,
            RiskLevel::Low,
            None,
            false,
        );
    }
    if category == "Virtual Disk" {
        return (
            category,
            Recommendation::ManualOnly,
            RiskLevel::High,
            None,
            false,
        );
    }
    if category == "System Area" {
        return (
            category,
            Recommendation::ManualOnly,
            RiskLevel::High,
            None,
            false,
        );
    }

    (
        category,
        Recommendation::ReviewFirst,
        RiskLevel::Medium,
        None,
        false,
    )
}

fn push_largest(items: &mut Vec<LargestItem>, next: LargestItem) {
    items.push(next);
    items.sort_by(|left, right| right.size.cmp(&left.size));
    if items.len() > MAX_LARGEST_ITEMS {
        items.truncate(MAX_LARGEST_ITEMS);
    }
}

fn should_capture_node(
    depth: u16,
    size: u64,
    is_known_target: bool,
    category: &str,
    current_len: usize,
) -> bool {
    current_len < MAX_CAPTURED_NODES
        && (depth <= 3
            || is_known_target
            || category == "Large Personal Data"
            || category == "Virtual Disk"
            || size >= LARGE_FOLDER_THRESHOLD_BYTES)
}

fn emit_walk_progress(app: &AppHandle, job_id: &str, visited_dirs: usize, label: String) {
    let _ = app.emit(
        "scan://event",
        ScanJobEvent {
            event_type: "progress".to_string(),
            job_id: job_id.to_string(),
            phase: Some(ScanPhase::Deep),
            current: Some(visited_dirs),
            total: None,
            label: Some(label),
            item: None,
            advisory: None,
            storage_nodes: None,
            largest_items: None,
            drive_summary: None,
            summary: None,
            message: None,
        },
    );
}

fn shallow_dir_stats(path: &Path) -> WalkStats {
    let mut stats = WalkStats {
        size: 0,
        file_count: 0,
        child_count: 0,
    };

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return stats,
    };

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            stats.child_count += 1;
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        stats.size += metadata.len();
        stats.file_count += 1;
    }

    stats
}

fn walk_dir(
    path: &Path,
    depth: u16,
    max_depth: u16,
    app: &AppHandle,
    job_id: &str,
    cancel_flag: &AtomicBool,
    state: &mut WalkState,
    known_targets: &HashMap<String, ScannedTarget>,
    root: &Path,
) -> WalkStats {
    if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
        return WalkStats {
            size: 0,
            file_count: 0,
            child_count: 0,
        };
    }

    state.visited_dirs += 1;
    if state.visited_dirs % 250 == 0 {
        emit_walk_progress(app, job_id, state.visited_dirs, path.display().to_string());
    }

    if depth >= max_depth {
        return shallow_dir_stats(path);
    }

    let mut stats = WalkStats {
        size: 0,
        file_count: 0,
        child_count: 0,
    };

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return stats,
    };

    for entry in entries {
        if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }

        let Ok(entry) = entry else {
            continue;
        };
        let child_path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            let child_stats = walk_dir(
                &child_path,
                depth + 1,
                max_depth,
                app,
                job_id,
                cancel_flag,
                state,
                known_targets,
                root,
            );
            stats.size += child_stats.size;
            stats.file_count += child_stats.file_count;
            stats.child_count += 1;

            let normalized = normalize_path(&child_path);
            let linked_target = known_targets.get(&normalized);
            let (category, recommendation, risk_level, linked_target_id, is_known_target) =
                classify_path(&child_path, linked_target, &state.user_roots);

            if depth <= 1 && category == "Large Personal Data" {
                state.personal_data_bytes += child_stats.size;
            }
            if depth <= 1 && category == "Virtual Disk" {
                state.virtual_disk_bytes += child_stats.size;
            }

            if child_stats.size >= LARGE_FOLDER_THRESHOLD_BYTES || is_known_target {
                push_largest(
                    &mut state.largest_dirs,
                    LargestItem {
                        id: path_id(&child_path),
                        path: child_path.display().to_string(),
                        name: display_name(&child_path, root),
                        node_type: StorageNodeType::Directory,
                        size: child_stats.size,
                        category: category.clone(),
                        recommendation: recommendation.clone(),
                        risk_level: risk_level.clone(),
                        linked_target_id: linked_target_id.clone(),
                    },
                );
            }

            if should_capture_node(
                depth + 1,
                child_stats.size,
                is_known_target,
                &category,
                state.nodes.len(),
            ) {
                state.nodes.push(StorageNode {
                    id: path_id(&child_path),
                    parent_id: child_path.parent().map(path_id),
                    path: child_path.display().to_string(),
                    name: display_name(&child_path, root),
                    node_type: StorageNodeType::Directory,
                    size: child_stats.size,
                    file_count: child_stats.file_count,
                    child_count: child_stats.child_count,
                    depth: depth + 1,
                    category,
                    recommendation,
                    risk_level,
                    linked_target_id,
                    is_known_target,
                });
            }
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let size = metadata.len();
        stats.size += size;
        stats.file_count += 1;

        if size >= LARGE_FILE_THRESHOLD_BYTES {
            let (category, recommendation, risk_level, linked_target_id, _) =
                classify_path(&child_path, None, &state.user_roots);
            state.large_file_bytes += size;
            push_largest(
                &mut state.largest_files,
                LargestItem {
                    id: path_id(&child_path),
                    path: child_path.display().to_string(),
                    name: display_name(&child_path, root),
                    node_type: StorageNodeType::File,
                    size,
                    category,
                    recommendation,
                    risk_level,
                    linked_target_id,
                },
            );
        }
    }

    stats
}

fn root_plan(path: PathBuf, max_depth: u16) -> RootScanPlan {
    RootScanPlan { path, max_depth }
}

fn build_scan_roots(root: &Path) -> Vec<RootScanPlan> {
    let mut plans = Vec::new();
    let mut seen = HashSet::<String>::new();

    let mut push_plan = |path: PathBuf, max_depth: u16| {
        if !path.exists() || !path.is_dir() {
            return;
        }
        let key = normalize_path(&path);
        if seen.insert(key) {
            plans.push(root_plan(path, max_depth));
        }
    };

    push_plan(root.join("Users"), USERS_DEPTH);
    push_plan(root.join("ProgramData"), PROGRAM_DATA_DEPTH);
    push_plan(root.join("Windows"), WINDOWS_DEPTH);
    push_plan(root.join("Program Files"), DEFAULT_SHALLOW_DEPTH);
    push_plan(root.join("Program Files (x86)"), DEFAULT_SHALLOW_DEPTH);

    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            let child_path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }

            let lower = normalize_path(&child_path);
            if lower == normalize_path(&root.join("Users"))
                || lower == normalize_path(&root.join("ProgramData"))
                || lower == normalize_path(&root.join("Windows"))
                || lower == normalize_path(&root.join("Program Files"))
                || lower == normalize_path(&root.join("Program Files (x86)"))
            {
                continue;
            }

            let depth = if is_virtual_disk_path(&child_path) {
                4
            } else {
                DEFAULT_SHALLOW_DEPTH
            };
            push_plan(child_path, depth);
        }
    }

    plans
}

pub fn run_drive_analysis(
    app: &AppHandle,
    job_id: &str,
    cancel_flag: &AtomicBool,
    known_results: &HashMap<String, ScannedTarget>,
    advisories: &[AdvisoryFinding],
) -> Option<DriveAnalysisResult> {
    let root = PathBuf::from(DRIVE_ROOT);
    if !root.exists() {
        return None;
    }

    let mut state = WalkState::new();
    let known_targets = known_results
        .values()
        .map(|item| (normalize_path(Path::new(&item.target.path)), item.clone()))
        .collect::<HashMap<_, _>>();
    let root_plans = build_scan_roots(&root);
    let mut root_stats = WalkStats {
        size: 0,
        file_count: 0,
        child_count: 0,
    };

    for plan in &root_plans {
        if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
            return None;
        }

        let stats = walk_dir(
            &plan.path,
            0,
            plan.max_depth,
            app,
            job_id,
            cancel_flag,
            &mut state,
            &known_targets,
            &root,
        );

        root_stats.size += stats.size;
        root_stats.file_count += stats.file_count;
        root_stats.child_count += 1;

        let normalized = normalize_path(&plan.path);
        let linked_target = known_targets.get(&normalized);
        let (category, recommendation, risk_level, linked_target_id, is_known_target) =
            classify_path(&plan.path, linked_target, &state.user_roots);
        state.nodes.push(StorageNode {
            id: path_id(&plan.path),
            parent_id: Some(path_id(&root)),
            path: plan.path.display().to_string(),
            name: display_name(&plan.path, &root),
            node_type: StorageNodeType::Directory,
            size: stats.size,
            file_count: stats.file_count,
            child_count: stats.child_count,
            depth: 1,
            category: category.clone(),
            recommendation: recommendation.clone(),
            risk_level: risk_level.clone(),
            linked_target_id: linked_target_id.clone(),
            is_known_target,
        });

        if stats.size >= LARGE_FOLDER_THRESHOLD_BYTES || is_known_target {
            push_largest(
                &mut state.largest_dirs,
                LargestItem {
                    id: path_id(&plan.path),
                    path: plan.path.display().to_string(),
                    name: display_name(&plan.path, &root),
                    node_type: StorageNodeType::Directory,
                    size: stats.size,
                    category,
                    recommendation,
                    risk_level,
                    linked_target_id,
                },
            );
        }
    }
    if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
        return None;
    }

    state.nodes.push(StorageNode {
        id: path_id(&root),
        parent_id: None,
        path: DRIVE_ROOT.to_string(),
        name: DRIVE_ROOT.to_string(),
        node_type: StorageNodeType::Drive,
        size: root_stats.size,
        file_count: root_stats.file_count,
        child_count: root_stats.child_count,
        depth: 0,
        category: "Drive".to_string(),
        recommendation: Recommendation::ReviewFirst,
        risk_level: RiskLevel::Medium,
        linked_target_id: None,
        is_known_target: false,
    });

    state.nodes.sort_by(|left, right| {
        right
            .size
            .cmp(&left.size)
            .then(left.depth.cmp(&right.depth))
    });

    let advisory_bytes = advisories.iter().map(|item| item.size).sum::<u64>();
    let cleanable_bytes = known_results
        .values()
        .filter(|item| item.recommendation == Recommendation::CleanNow)
        .map(|item| item.size)
        .sum::<u64>();

    let mut largest_items = state.largest_dirs;
    largest_items.extend(state.largest_files);
    largest_items.sort_by(|left, right| right.size.cmp(&left.size));
    largest_items.truncate(MAX_LARGEST_ITEMS);

    Some(DriveAnalysisResult {
        summary: DriveAnalysisSummary {
            root_path: DRIVE_ROOT.to_string(),
            engine_used: "adaptive_priority_scan".to_string(),
            cache_state: "rebuilding".to_string(),
            admin_acceleration: has_admin_acceleration(),
            last_indexed_at: Some(unix_now()),
            total_bytes: root_stats.size,
            cleanable_bytes,
            advisory_bytes,
            personal_data_bytes: state.personal_data_bytes,
            virtual_disk_bytes: state.virtual_disk_bytes,
            large_file_bytes: state.large_file_bytes,
            node_count: state.nodes.len(),
            largest_file_count: largest_items
                .iter()
                .filter(|item| item.node_type == StorageNodeType::File)
                .count(),
        },
        nodes: state.nodes,
        largest_items,
    })
}
