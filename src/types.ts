export type SafeLevel = "safe" | "conditional" | "unsafe";
export type AvailabilityStatus = "available" | "missing" | "inaccessible";
export type Recommendation =
  | "clean_now"
  | "review_first"
  | "manual_only"
  | "unavailable";
export type RiskLevel = "low" | "medium" | "high";

export interface Target {
  id: string;
  name: string;
  path: string;
  type: string;
  icon: string;
  description: string;
  safeToDelete: SafeLevel;
  safeNote: string;
  cleanCommand?: string;
}

export interface DiskInfo {
  total: number;
  free: number;
  used: number;
}

export interface ScanEvidence {
  pathExists: boolean;
  readable: boolean;
  isDirectory: boolean;
  skippedItems: number;
  estimatedBytes: number;
  fileCount: number;
  preflightPassed: boolean;
  safeLevel: SafeLevel;
}

export interface ScannedTarget extends Target {
  size: number;
  files: number;
  skippedItems: number;
  availabilityStatus: AvailabilityStatus;
  scanNote?: string;
  recommendation: Recommendation;
  riskLevel: RiskLevel;
  reason: string;
  evidence: ScanEvidence;
}

export type CleanVerificationStatus = "verified" | "partial" | "blocked";

export interface CleanResult {
  id: string;
  name: string;
  success: boolean;
  freedBytes: number;
  deletedFiles: number;
  errors: string[];
  estimatedBytes: number;
  remainingBytes: number;
  verificationStatus: CleanVerificationStatus;
  verificationNote: string;
}

export interface OpenFolderResult {
  opened: boolean;
  message: string;
  path: string;
}
