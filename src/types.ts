export type SafeLevel = "safe" | "conditional" | "unsafe";

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

export type ScanStatus = "ok" | "missing" | "inaccessible";

export interface ScannedTarget extends Target {
  size: number;
  files: number;
  skippedItems: number;
  scanStatus: ScanStatus;
  scanNote?: string;
}

export interface CleanResult {
  id: string;
  name: string;
  success: boolean;
  freedBytes: number;
  deletedFiles: number;
  errors: string[];
}

export interface OpenFolderResult {
  opened: boolean;
  message: string;
  path: string;
}
