use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::drive_analysis::has_admin_acceleration;
use crate::types::{
    DriveAnalysisSummary, LargestItem, Recommendation, RiskLevel, ScanJobEvent, ScanPhase,
    ScannedTarget, StorageNode, StorageNodeType,
};

const DRIVE_ROOT: &str = "C:\\";
const LARGE_FOLDER_THRESHOLD_BYTES: u64 = 256 * 1024 * 1024;
const LARGE_FILE_THRESHOLD_BYTES: u64 = 128 * 1024 * 1024;
const MAX_CAPTURED_NODES: usize = 1800;
const MAX_LARGEST_ITEMS: usize = 160;
const WIZTREE_EXPORT_TIMEOUT_SECONDS: u64 = 300;
const WIZTREE_PORTABLE_URL: &str = "https://diskanalyzer.com/files/wiztree_4_31_portable.zip";
const WIZTREE_PORTABLE_FOLDER: &str = "wiztree_4_31_portable";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WizTreeConfig {
    custom_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WizTreeStatus {
    pub available: bool,
    pub path: Option<String>,
    pub source: String,
    pub message: String,
    pub can_download: bool,
}

#[derive(Clone, Debug)]
pub struct WizTreeEntry {
    pub path: String,
    pub size: u64,
    pub files: u64,
    pub folders: u64,
    pub is_dir: bool,
}

#[derive(Clone, Debug)]
pub struct WizTreeScanResult {
    pub summary: DriveAnalysisSummary,
    pub nodes: Vec<StorageNode>,
    pub largest_items: Vec<LargestItem>,
    pub entries_by_path: HashMap<String, WizTreeEntry>,
}

struct UserRoots {
    roots: Vec<String>,
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs()
}

fn normalize_path(path: &Path) -> String {
    normalize_path_str(&path.to_string_lossy())
}

fn normalize_path_str(path: &str) -> String {
    let mut normalized = path.replace('/', "\\").to_ascii_lowercase();
    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }
    normalized
}

fn path_id(path: &str) -> String {
    normalize_path_str(path)
}

fn display_name(path: &str) -> String {
    if normalize_path_str(path) == normalize_path_str(DRIVE_ROOT) {
        return DRIVE_ROOT.to_string();
    }

    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.trim_end_matches(['\\', '/']).to_string())
}

fn parent_id(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches(['\\', '/']);
    Path::new(trimmed)
        .parent()
        .map(|parent| normalize_path(&parent.to_path_buf()))
}

fn depth_of(path: &str) -> u16 {
    let normalized = normalize_path_str(path);
    let without_drive = normalized
        .strip_prefix("c:\\")
        .or_else(|| normalized.strip_prefix("c:"))
        .unwrap_or(&normalized);
    without_drive
        .split('\\')
        .filter(|segment| !segment.is_empty())
        .count() as u16
}

fn build_user_roots() -> UserRoots {
    let roots = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|base| {
            ["Desktop", "Documents", "Downloads", "Pictures", "Videos"]
                .iter()
                .map(|segment| normalize_path(&base.join(segment)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    UserRoots { roots }
}

fn is_virtual_disk_path(path: &str) -> bool {
    let lower = normalize_path_str(path);
    lower.ends_with(".vhdx")
        || lower.ends_with(".vhd")
        || lower.ends_with(".vmdk")
        || lower.ends_with(".vdi")
        || lower.ends_with(".qcow2")
        || lower.contains("\\docker\\")
        || lower.contains("\\wsl\\")
        || lower.contains("\\virtual hard disks\\")
}

fn category_for_path(path: &str, user_roots: &UserRoots) -> &'static str {
    let lower = normalize_path_str(path);
    if user_roots
        .roots
        .iter()
        .any(|prefix| lower.starts_with(prefix))
    {
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
    path: &str,
    linked_target: Option<&ScannedTarget>,
    user_roots: &UserRoots,
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
    if category == "Virtual Disk" || category == "System Area" {
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

fn parse_u64(value: Option<&str>) -> u64 {
    value
        .unwrap_or_default()
        .trim()
        .parse::<u64>()
        .unwrap_or_default()
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .or_else(|_| {
            dirs::data_local_dir()
                .map(|base| base.join("usagedisk"))
                .ok_or_else(|| tauri::Error::AssetNotFound("app data dir".into()))
        })
        .map_err(|error| error.to_string())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("wiztree-config.json"))
}

fn downloaded_wiztree_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(WIZTREE_PORTABLE_FOLDER))
}

fn load_config(app: &AppHandle) -> WizTreeConfig {
    let Ok(path) = config_path(app) else {
        return WizTreeConfig { custom_path: None };
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return WizTreeConfig { custom_path: None };
    };
    serde_json::from_str(&raw).unwrap_or(WizTreeConfig { custom_path: None })
}

fn save_config(app: &AppHandle, config: &WizTreeConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let payload = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

fn push_candidate(candidates: &mut Vec<(PathBuf, String)>, path: PathBuf, source: &str) {
    candidates.push((path, source.to_string()));
}

fn preferred_wiztree_exe(path: PathBuf) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if file_name != "wiztree.exe" {
        return path;
    }

    let Some(parent) = path.parent() else {
        return path;
    };
    let sibling_64 = parent.join("WizTree64.exe");
    if sibling_64.is_file() {
        return sibling_64;
    }
    path
}

fn resolve_wiztree_exe_with_source(app: &AppHandle) -> Option<(PathBuf, String)> {
    let mut candidates = Vec::new();

    let config = load_config(app);
    if let Some(raw_path) = config.custom_path {
        push_candidate(&mut candidates, PathBuf::from(raw_path), "selected");
    }

    if let Some(raw_path) = std::env::var_os("USAGEDISK_WIZTREE_PATH") {
        push_candidate(&mut candidates, PathBuf::from(raw_path), "env");
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        push_candidate(
            &mut candidates,
            resource_dir
                .join(WIZTREE_PORTABLE_FOLDER)
                .join("WizTree64.exe"),
            "bundled",
        );
        push_candidate(
            &mut candidates,
            resource_dir.join("WizTree64.exe"),
            "resource",
        );
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            push_candidate(
                &mut candidates,
                parent.join(WIZTREE_PORTABLE_FOLDER).join("WizTree64.exe"),
                "app_dir",
            );
            push_candidate(&mut candidates, parent.join("WizTree64.exe"), "app_dir");
        }
    }

    if let Ok(downloaded_dir) = downloaded_wiztree_dir(app) {
        push_candidate(
            &mut candidates,
            downloaded_dir.join("WizTree64.exe"),
            "downloaded",
        );
    }

    if let Ok(current_dir) = std::env::current_dir() {
        push_candidate(
            &mut candidates,
            current_dir
                .join(WIZTREE_PORTABLE_FOLDER)
                .join("WizTree64.exe"),
            "workspace",
        );
        push_candidate(
            &mut candidates,
            current_dir
                .join("..")
                .join(WIZTREE_PORTABLE_FOLDER)
                .join("WizTree64.exe"),
            "workspace",
        );
    }

    candidates.into_iter().find_map(|(path, source)| {
        if !path.is_file() {
            return None;
        }
        Some((preferred_wiztree_exe(path), source))
    })
}

fn resolve_wiztree_exe(app: &AppHandle) -> Result<PathBuf, String> {
    resolve_wiztree_exe_with_source(app)
        .map(|(path, _source)| path)
        .ok_or_else(|| {
            "WizTree64.exe tidak ditemukan. Pilih file WizTree64.exe atau download portable dari panel WizTree.".to_string()
        })
}

pub fn get_wiztree_status(app: &AppHandle) -> WizTreeStatus {
    if let Some((path, source)) = resolve_wiztree_exe_with_source(app) {
        return WizTreeStatus {
            available: true,
            path: Some(path.display().to_string()),
            source,
            message: "WizTree siap dipakai untuk scan cepat.".to_string(),
            can_download: true,
        };
    }

    WizTreeStatus {
        available: false,
        path: None,
        source: "missing".to_string(),
        message:
            "WizTree belum ditemukan. Pilih WizTree64.exe yang sudah ada atau download portable resmi."
                .to_string(),
        can_download: true,
    }
}

pub fn pick_wiztree_exe(app: &AppHandle) -> Result<WizTreeStatus, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("Pilih WizTree64.exe")
        .add_filter("WizTree executable", &["exe"])
        .pick_file()
    else {
        return Ok(get_wiztree_status(app));
    };

    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if name != "wiztree64.exe" && name != "wiztree.exe" {
        return Err("File yang dipilih harus WizTree64.exe atau WizTree.exe.".to_string());
    }

    let selected_path = preferred_wiztree_exe(path);
    save_config(
        app,
        &WizTreeConfig {
            custom_path: Some(selected_path.display().to_string()),
        },
    )?;
    Ok(get_wiztree_status(app))
}

pub fn download_wiztree(app: &AppHandle) -> Result<WizTreeStatus, String> {
    let target_dir = downloaded_wiztree_dir(app)?;
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let zip_path = target_dir.with_extension("zip");
    let parent = target_dir
        .parent()
        .ok_or_else(|| "Folder target download tidak valid.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let script = format!(
        "$ProgressPreference='SilentlyContinue'; \
         Invoke-WebRequest -UseBasicParsing -Uri '{}' -OutFile '{}'; \
         if (Test-Path -LiteralPath '{}') {{ Remove-Item -LiteralPath '{}' -Recurse -Force }}; \
         Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
        WIZTREE_PORTABLE_URL,
        zip_path.display(),
        target_dir.display(),
        target_dir.display(),
        zip_path.display(),
        parent.display(),
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|error| format!("Gagal menjalankan downloader PowerShell: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Download WizTree gagal: {stderr}"));
    }

    let exe = [
        target_dir.join("WizTree64.exe"),
        parent.join("WizTree64.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .or_else(|| {
        fs::read_dir(parent).ok()?.find_map(|entry| {
            let path = entry.ok()?.path().join("WizTree64.exe");
            path.is_file().then_some(path)
        })
    })
    .ok_or_else(|| {
        "Download selesai, tetapi WizTree64.exe tidak ditemukan di hasil ekstrak.".to_string()
    })?;

    save_config(
        app,
        &WizTreeConfig {
            custom_path: Some(exe.display().to_string()),
        },
    )?;
    Ok(get_wiztree_status(app))
}

fn export_path(job_id: &str) -> Result<PathBuf, String> {
    let base = dirs::cache_dir()
        .ok_or_else(|| "cache directory tidak tersedia".to_string())?
        .join("usagedisk")
        .join("wiztree");
    fs::create_dir_all(&base).map_err(|error| error.to_string())?;
    Ok(base.join(format!("{job_id}.csv")))
}

fn run_wiztree_export(
    app: &AppHandle,
    job_id: &str,
    cancel_flag: &AtomicBool,
) -> Result<PathBuf, String> {
    let exe = resolve_wiztree_exe(app)?;
    let export_path = export_path(job_id)?;
    let _ = fs::remove_file(&export_path);
    let admin_arg = if has_admin_acceleration() {
        "/admin=1"
    } else {
        "/admin=0"
    };

    let mut child = Command::new(&exe)
        .arg(DRIVE_ROOT)
        .arg(format!("/export={}", export_path.display()))
        .arg(admin_arg)
        .arg("/exportfolders=1")
        .arg("/exportfiles=1")
        .arg("/sortby=2")
        .spawn()
        .map_err(|error| format!("Gagal menjalankan WizTree: {error}"))?;
    let started_at = SystemTime::now();
    let mut process_finished = false;
    let mut last_export_size = 0;
    let mut stable_export_checks = 0;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = child.kill();
            return Err("Scan WizTree dibatalkan.".to_string());
        }
        let elapsed = started_at
            .elapsed()
            .unwrap_or_else(|_| Duration::from_secs(0))
            .as_secs();
        if elapsed > WIZTREE_EXPORT_TIMEOUT_SECONDS {
            let _ = child.kill();
            return Err(format!(
                "WizTree tidak selesai dalam {} detik. Coba jalankan app sebagai Administrator atau gunakan mode Adaptive.",
                WIZTREE_EXPORT_TIMEOUT_SECONDS
            ));
        }

        if process_finished {
            if let Ok(metadata) = fs::metadata(&export_path) {
                let export_size = metadata.len();
                if export_size > 0 && export_size == last_export_size {
                    stable_export_checks += 1;
                } else {
                    stable_export_checks = 0;
                    last_export_size = export_size;
                }
                if stable_export_checks >= 2 {
                    return Ok(export_path);
                }
            }
        }

        if !process_finished {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        return Err(format!("WizTree selesai dengan status {status}."));
                    }
                    process_finished = true;
                    last_export_size = 0;
                    stable_export_checks = 0;
                }
                Ok(None) => {}
                Err(error) => return Err(format!("Gagal menunggu WizTree: {error}")),
            }
        }

        let export_size = fs::metadata(&export_path)
            .map(|metadata| metadata.len())
            .unwrap_or_default();
        let label = if process_finished {
            if export_size == 0 {
                format!("Menunggu CSV WizTree selesai ditulis... {} detik", elapsed)
            } else {
                format!(
                    "Menstabilkan CSV WizTree ({})... {} detik",
                    human_bytes(export_size),
                    elapsed
                )
            }
        } else {
            format!("WizTree mengekspor index MFT... {} detik", elapsed)
        };

        let _ = app.emit(
            "scan://event",
            ScanJobEvent {
                event_type: "progress".to_string(),
                job_id: job_id.to_string(),
                phase: Some(ScanPhase::Deep),
                current: None,
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
        std::thread::sleep(Duration::from_millis(750));
    }
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        return format!("{bytes} {}", UNITS[unit]);
    }
    format!("{size:.1} {}", UNITS[unit])
}

fn read_wiztree_entries(path: &Path) -> Result<Vec<WizTreeEntry>, String> {
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let csv_start = raw
        .find("File Name,")
        .ok_or_else(|| "CSV WizTree tidak berisi header File Name.".to_string())?;
    let csv_payload = &raw[csv_start..];
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(csv_payload.as_bytes());
    let mut entries = Vec::new();

    for record in reader.records() {
        let record =
            record.map_err(|error| format!("Gagal membaca CSV export WizTree: {error}"))?;
        let Some(path) = record.get(0).map(str::trim).filter(|item| !item.is_empty()) else {
            continue;
        };
        let size = parse_u64(record.get(1));
        let files = parse_u64(record.get(5));
        let folders = parse_u64(record.get(6));
        let is_dir = path.ends_with('\\') || path.ends_with('/');
        entries.push(WizTreeEntry {
            path: path.to_string(),
            size,
            files,
            folders,
            is_dir,
        });
    }

    Ok(entries)
}

fn push_largest(items: &mut Vec<LargestItem>, next: LargestItem) {
    items.push(next);
    items.sort_by(|left, right| right.size.cmp(&left.size));
    if items.len() > MAX_LARGEST_ITEMS {
        items.truncate(MAX_LARGEST_ITEMS);
    }
}

fn should_capture_node(depth: u16, size: u64, is_known_target: bool, category: &str) -> bool {
    depth <= 3
        || is_known_target
        || category == "Large Personal Data"
        || category == "Virtual Disk"
        || size >= LARGE_FOLDER_THRESHOLD_BYTES
}

fn build_result_from_entries(
    entries: Vec<WizTreeEntry>,
    known_results: &HashMap<String, ScannedTarget>,
) -> WizTreeScanResult {
    let user_roots = build_user_roots();
    let known_targets = known_results
        .values()
        .map(|item| (normalize_path_str(&item.target.path), item.clone()))
        .collect::<HashMap<_, _>>();
    let mut nodes = Vec::new();
    let mut largest_files = Vec::new();
    let mut largest_dirs = Vec::new();
    let mut entries_by_path = HashMap::new();
    let mut captured_ids = HashSet::new();
    let mut root_size = 0;
    let mut root_file_count = 0;
    let mut personal_data_bytes = 0;
    let mut virtual_disk_bytes = 0;
    let mut large_file_bytes = 0;

    for entry in entries {
        let id = path_id(&entry.path);
        root_size = root_size.max(entry.size);
        root_file_count = root_file_count.max(entry.files);
        entries_by_path.insert(id.clone(), entry.clone());

        let linked_target = known_targets.get(&id);
        let (category, recommendation, risk_level, linked_target_id, is_known_target) =
            classify_path(&entry.path, linked_target, &user_roots);

        if entry.is_dir {
            let depth = depth_of(&entry.path);
            if depth <= 2 && category == "Large Personal Data" {
                personal_data_bytes += entry.size;
            }
            if depth <= 2 && category == "Virtual Disk" {
                virtual_disk_bytes += entry.size;
            }
            if entry.size >= LARGE_FOLDER_THRESHOLD_BYTES || is_known_target {
                push_largest(
                    &mut largest_dirs,
                    LargestItem {
                        id: id.clone(),
                        path: entry.path.clone(),
                        name: display_name(&entry.path),
                        node_type: StorageNodeType::Directory,
                        size: entry.size,
                        category: category.clone(),
                        recommendation: recommendation.clone(),
                        risk_level: risk_level.clone(),
                        linked_target_id: linked_target_id.clone(),
                    },
                );
            }

            if nodes.len() < MAX_CAPTURED_NODES
                && entry.size > 0
                && should_capture_node(depth, entry.size, is_known_target, &category)
            {
                captured_ids.insert(id.clone());
                nodes.push(StorageNode {
                    id,
                    parent_id: parent_id(&entry.path),
                    path: entry.path.clone(),
                    name: display_name(&entry.path),
                    node_type: StorageNodeType::Directory,
                    size: entry.size,
                    file_count: entry.files,
                    child_count: entry.folders,
                    depth,
                    category,
                    recommendation,
                    risk_level,
                    linked_target_id,
                    is_known_target,
                });
            }
            continue;
        }

        if entry.size >= LARGE_FILE_THRESHOLD_BYTES {
            let (category, recommendation, risk_level, linked_target_id, _) =
                classify_path(&entry.path, None, &user_roots);
            large_file_bytes += entry.size;
            push_largest(
                &mut largest_files,
                LargestItem {
                    id,
                    path: entry.path.clone(),
                    name: display_name(&entry.path),
                    node_type: StorageNodeType::File,
                    size: entry.size,
                    category,
                    recommendation,
                    risk_level,
                    linked_target_id,
                },
            );
        }
    }

    let root_id = normalize_path_str(DRIVE_ROOT);
    if !captured_ids.contains(&root_id) {
        nodes.push(StorageNode {
            id: root_id,
            parent_id: None,
            path: DRIVE_ROOT.to_string(),
            name: DRIVE_ROOT.to_string(),
            node_type: StorageNodeType::Drive,
            size: root_size,
            file_count: root_file_count,
            child_count: 0,
            depth: 0,
            category: "Drive".to_string(),
            recommendation: Recommendation::ReviewFirst,
            risk_level: RiskLevel::Medium,
            linked_target_id: None,
            is_known_target: false,
        });
    }

    nodes.sort_by(|left, right| {
        right
            .size
            .cmp(&left.size)
            .then(left.depth.cmp(&right.depth))
    });
    let mut largest_items = largest_dirs;
    largest_items.extend(largest_files);
    largest_items.sort_by(|left, right| right.size.cmp(&left.size));
    largest_items.truncate(MAX_LARGEST_ITEMS);

    WizTreeScanResult {
        summary: DriveAnalysisSummary {
            root_path: DRIVE_ROOT.to_string(),
            engine_used: "wiztree_metafile".to_string(),
            cache_state: "fresh_export".to_string(),
            admin_acceleration: has_admin_acceleration(),
            last_indexed_at: Some(unix_now()),
            total_bytes: root_size,
            cleanable_bytes: known_results
                .values()
                .filter(|item| item.recommendation == Recommendation::CleanNow)
                .map(|item| item.size)
                .sum(),
            advisory_bytes: 0,
            personal_data_bytes,
            virtual_disk_bytes,
            large_file_bytes,
            node_count: nodes.len(),
            largest_file_count: largest_items
                .iter()
                .filter(|item| item.node_type == StorageNodeType::File)
                .count(),
        },
        nodes,
        largest_items,
        entries_by_path,
    }
}

pub fn run_wiztree_scan(
    app: &AppHandle,
    job_id: &str,
    cancel_flag: &AtomicBool,
    known_results: &HashMap<String, ScannedTarget>,
) -> Result<WizTreeScanResult, String> {
    let export = run_wiztree_export(app, job_id, cancel_flag)?;
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("Scan WizTree dibatalkan.".to_string());
    }
    let entries = read_wiztree_entries(&export)?;
    Ok(build_result_from_entries(entries, known_results))
}

pub fn normalized_lookup_key(path: &str) -> String {
    normalize_path_str(path)
}

#[cfg(test)]
mod tests {
    use super::read_wiztree_entries;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reads_wiztree_csv_with_variable_record_lengths() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("usagedisk-wiztree-{suffix}.csv"));
        fs::write(
            &path,
            r#"Generated by WizTree
File Name,Size,Allocated,Modified,Attributes,Files,Folders,DRIVECAPACITY,FREESPACE,USEDSPACE,RESERVEDSPACE
"C:\",100,100,2026/05/21 18:00:00,0,10,2,200,50,150,0
"C:\Users\",60,60,2026/05/21 18:00:00,16,8,1
"C:\Users\large.bin",40,40,2026/05/21 18:00:00,32,0,0
"#,
        )
        .expect("write fixture csv");

        let entries = read_wiztree_entries(&path).expect("parse wiztree csv");
        let _ = fs::remove_file(path);

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].path, "C:\\");
        assert_eq!(entries[1].files, 8);
        assert!(entries[1].is_dir);
        assert!(!entries[2].is_dir);
    }
}
