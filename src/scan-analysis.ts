import type {
  AvailabilityStatus,
  Recommendation,
  RiskLevel,
  SafeLevel,
  ScanEvidence,
} from "./types";

interface ScanAssessmentInput {
  availabilityStatus: AvailabilityStatus;
  safeToDelete: SafeLevel;
  skippedItems: number;
  size: number;
  files: number;
}

export interface ScanAssessment {
  recommendation: Recommendation;
  riskLevel: RiskLevel;
  reason: string;
  evidence: ScanEvidence;
}

export function buildScanAssessment(
  input: ScanAssessmentInput,
): ScanAssessment {
  const { availabilityStatus, safeToDelete, skippedItems, size, files } = input;
  const pathExists = availabilityStatus !== "missing";
  const readable = availabilityStatus === "available";
  const isDirectory = availabilityStatus === "available";
  const preflightPassed =
    availabilityStatus === "available" &&
    safeToDelete === "safe" &&
    skippedItems === 0;

  let recommendation: Recommendation;
  let riskLevel: RiskLevel;
  let reason: string;

  if (availabilityStatus === "missing") {
    recommendation = "unavailable";
    riskLevel = "high";
    reason = "Folder target tidak ditemukan di mesin ini.";
  } else if (availabilityStatus === "inaccessible") {
    recommendation = "unavailable";
    riskLevel = "high";
    reason =
      "Folder ada tetapi aksesnya tertahan, jadi belum bisa diverifikasi.";
  } else if (safeToDelete === "unsafe") {
    recommendation = "manual_only";
    riskLevel = "high";
    reason =
      "Target ini berisiko tinggi dan hanya aman ditangani secara manual.";
  } else if (safeToDelete === "conditional") {
    recommendation = "review_first";
    riskLevel = "medium";
    reason = "Target ini perlu review manual sebelum dibersihkan.";
  } else if (skippedItems > 0) {
    recommendation = "review_first";
    riskLevel = "medium";
    reason =
      "Sebagian isi folder tidak terbaca, jadi auto-clean ditahan sampai Anda review.";
  } else if (size === 0 && files === 0) {
    recommendation = "clean_now";
    riskLevel = "low";
    reason = "Folder aman dan lolos preflight, tetapi saat ini sudah kosong.";
  } else {
    recommendation = "clean_now";
    riskLevel = "low";
    reason = "Folder aman, bisa dibaca penuh, dan siap dibersihkan sekarang.";
  }

  return {
    recommendation,
    riskLevel,
    reason,
    evidence: {
      pathExists,
      readable,
      isDirectory,
      skippedItems,
      estimatedBytes: size,
      fileCount: files,
      preflightPassed,
      safeLevel: safeToDelete,
    },
  };
}

export function canAutoClean(recommendation: Recommendation): boolean {
  return recommendation === "clean_now";
}
