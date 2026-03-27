use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

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
    path.to_string_lossy().replace('/', "\\").to_ascii_lowercase()
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

fn walk_dir(
    path: &Path,
    depth: u16,
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

    let root_stats = walk_dir(&root, 0, app, job_id, cancel_flag, &mut state, &known_targets, &root);
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

    state
        .nodes
        .sort_by(|left, right| right.size.cmp(&left.size).then(left.depth.cmp(&right.depth)));

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
            engine_used: "hybrid_ntfs_fallback".to_string(),
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
