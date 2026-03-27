use crate::types::{
    AvailabilityStatus, Recommendation, RiskLevel, SafeLevel, ScanAssessment, ScanEvidence,
};

pub fn build_scan_assessment(
    availability_status: AvailabilityStatus,
    safe_to_delete: SafeLevel,
    skipped_items: u64,
    size: u64,
    files: u64,
) -> ScanAssessment {
    let path_exists = availability_status != AvailabilityStatus::Missing;
    let readable = availability_status == AvailabilityStatus::Available;
    let is_directory = availability_status == AvailabilityStatus::Available;
    let preflight_passed = availability_status == AvailabilityStatus::Available
        && safe_to_delete == SafeLevel::Safe
        && skipped_items == 0;

    let (recommendation, risk_level, reason) = if availability_status == AvailabilityStatus::Missing
    {
        (
            Recommendation::Unavailable,
            RiskLevel::High,
            "Folder target tidak ditemukan di mesin ini.",
        )
    } else if availability_status == AvailabilityStatus::Inaccessible {
        (
            Recommendation::Unavailable,
            RiskLevel::High,
            "Folder ada tetapi aksesnya tertahan, jadi belum bisa diverifikasi.",
        )
    } else if safe_to_delete == SafeLevel::Unsafe {
        (
            Recommendation::ManualOnly,
            RiskLevel::High,
            "Target ini berisiko tinggi dan hanya aman ditangani secara manual.",
        )
    } else if safe_to_delete == SafeLevel::Conditional {
        (
            Recommendation::ReviewFirst,
            RiskLevel::Medium,
            "Target ini perlu review manual sebelum dibersihkan.",
        )
    } else if skipped_items > 0 {
        (
            Recommendation::ReviewFirst,
            RiskLevel::Medium,
            "Sebagian isi folder tidak terbaca, jadi auto-clean ditahan sampai Anda review.",
        )
    } else if size == 0 && files == 0 {
        (
            Recommendation::CleanNow,
            RiskLevel::Low,
            "Folder aman dan lolos preflight, tetapi saat ini sudah kosong.",
        )
    } else {
        (
            Recommendation::CleanNow,
            RiskLevel::Low,
            "Folder aman, bisa dibaca penuh, dan siap dibersihkan sekarang.",
        )
    };

    ScanAssessment {
        recommendation,
        risk_level,
        reason: reason.to_string(),
        evidence: ScanEvidence {
            path_exists,
            readable,
            is_directory,
            skipped_items,
            estimated_bytes: size,
            file_count: files,
            preflight_passed,
            safe_level: safe_to_delete,
        },
    }
}

pub fn can_auto_clean(recommendation: &Recommendation) -> bool {
    recommendation == &Recommendation::CleanNow
}
