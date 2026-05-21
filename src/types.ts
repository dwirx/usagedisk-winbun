export type SafeLevel = "safe" | "conditional" | "unsafe";
export type AvailabilityStatus = "available" | "missing" | "inaccessible";
export type Recommendation =
  | "clean_now"
  | "review_first"
  | "manual_only"
  | "unavailable";
export type RiskLevel = "low" | "medium" | "high";
export type ScanMode = "quick" | "deep" | "adaptive" | "wiztree";
export type ScanPhase = "quick" | "deep" | "diagnostics";
export type StorageNodeType = "drive" | "directory" | "file";

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
  isEstimate: boolean;
  deepScanCompleted: boolean;
  scanModeUsed: ScanMode;
  recommendation: Recommendation;
  riskLevel: RiskLevel;
  reason: string;
  evidence: ScanEvidence;
}

export interface AdvisoryFinding {
  id: string;
  name: string;
  category: string;
  severity: RiskLevel;
  size: number;
  reason: string;
  suggestedAction: string;
  path?: string;
  scanNote?: string;
}

export interface StorageNode {
  id: string;
  parentId?: string;
  path: string;
  name: string;
  nodeType: StorageNodeType;
  size: number;
  fileCount: number;
  childCount: number;
  depth: number;
  category: string;
  recommendation: Recommendation;
  riskLevel: RiskLevel;
  linkedTargetId?: string;
  isKnownTarget: boolean;
}

export interface LargestItem {
  id: string;
  path: string;
  name: string;
  nodeType: Exclude<StorageNodeType, "drive">;
  size: number;
  category: string;
  recommendation: Recommendation;
  riskLevel: RiskLevel;
  linkedTargetId?: string;
}

export interface DriveAnalysisSummary {
  rootPath: string;
  engineUsed: string;
  cacheState: string;
  adminAcceleration: boolean;
  lastIndexedAt?: number;
  totalBytes: number;
  cleanableBytes: number;
  advisoryBytes: number;
  personalDataBytes: number;
  virtualDiskBytes: number;
  largeFileBytes: number;
  nodeCount: number;
  largestFileCount: number;
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

export interface WizTreeStatus {
  available: boolean;
  path?: string;
  source: string;
  message: string;
  canDownload: boolean;
}

export interface ScanJobSummary {
  checked: number;
  found: number;
  missing: number;
  inaccessible: number;
  skippedItems: number;
  advisories: number;
}

export interface ScanJobEvent {
  type:
    | "started"
    | "progress"
    | "target"
    | "advisory"
    | "storage_batch"
    | "largest_batch"
    | "drive_summary"
    | "done"
    | "cancelled"
    | "error";
  jobId: string;
  phase?: ScanPhase;
  current?: number;
  total?: number;
  label?: string;
  item?: ScannedTarget;
  advisory?: AdvisoryFinding;
  storageNodes?: StorageNode[];
  largestItems?: LargestItem[];
  driveSummary?: DriveAnalysisSummary;
  summary?: ScanJobSummary;
  message?: string;
}
