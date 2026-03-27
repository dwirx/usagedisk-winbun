use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SafeLevel {
    Safe,
    Conditional,
    Unsafe,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AvailabilityStatus {
    Available,
    Missing,
    Inaccessible,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Recommendation {
    CleanNow,
    ReviewFirst,
    ManualOnly,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub category: String,
    pub icon: String,
    pub description: String,
    pub safe_to_delete: SafeLevel,
    pub safe_note: String,
    pub clean_command: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub total: u64,
    pub free: u64,
    pub used: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanEvidence {
    pub path_exists: bool,
    pub readable: bool,
    pub is_directory: bool,
    pub skipped_items: u64,
    pub estimated_bytes: u64,
    pub file_count: u64,
    pub preflight_passed: bool,
    pub safe_level: SafeLevel,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanAssessment {
    pub recommendation: Recommendation,
    pub risk_level: RiskLevel,
    pub reason: String,
    pub evidence: ScanEvidence,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedTarget {
    #[serde(flatten)]
    pub target: Target,
    pub size: u64,
    pub files: u64,
    pub skipped_items: u64,
    pub availability_status: AvailabilityStatus,
    pub scan_note: Option<String>,
    pub recommendation: Recommendation,
    pub risk_level: RiskLevel,
    pub reason: String,
    pub evidence: ScanEvidence,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CleanVerificationStatus {
    Verified,
    Partial,
    Blocked,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub id: String,
    pub name: String,
    pub success: bool,
    pub freed_bytes: u64,
    pub deleted_files: u64,
    pub errors: Vec<String>,
    pub estimated_bytes: u64,
    pub remaining_bytes: u64,
    pub verification_status: CleanVerificationStatus,
    pub verification_note: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFolderResult {
    pub opened: bool,
    pub message: String,
    pub path: String,
}
