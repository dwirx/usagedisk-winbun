import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  CleanResult,
  DiskInfo,
  OpenFolderResult,
  ScanJobEvent,
  ScanMode,
  ScannedTarget,
  Target,
  WizTreeStatus,
} from "./types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request gagal (${response.status})`);
  }
  return (await response.json()) as T;
}

function isTauriCommandUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("window.__TAURI_INTERNALS__") ||
      error.message.includes("Cannot read properties of undefined") ||
      error.message.includes("ipc"))
  );
}

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeOrFallback<T>(
  command: string,
  args: Record<string, unknown>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (isTauriCommandUnavailable(error)) {
      return fallback();
    }
    throw error;
  }
}

export function getTargets(): Promise<Target[]> {
  return invokeOrFallback("get_targets", {}, () =>
    fetchJson<Target[]>("/api/targets"),
  );
}

export function getDiskInfo(): Promise<DiskInfo> {
  return invokeOrFallback("get_disk_info", {}, () =>
    fetchJson<DiskInfo>("/api/diskinfo"),
  );
}

export function scanTarget(id: string): Promise<ScannedTarget> {
  return invokeOrFallback("scan_target", { id }, () =>
    fetchJson<ScannedTarget>(`/api/scan/${encodeURIComponent(id)}`),
  );
}

export function startScanJob(mode: ScanMode): Promise<string> {
  return invoke<string>("start_scan", { mode });
}

export function cancelScanJob(jobId: string): Promise<void> {
  return invoke<void>("cancel_scan", { jobId });
}

export function listenScanEvents(
  handler: (event: ScanJobEvent) => void,
): Promise<UnlistenFn> {
  return listen<ScanJobEvent>("scan://event", ({ payload }) => {
    handler(payload);
  });
}

export function cleanTarget(id: string): Promise<CleanResult> {
  return invoke<CleanResult>("clean_target", { id });
}

export function openTargetFolder(id: string): Promise<OpenFolderResult> {
  return invokeOrFallback("open_target_folder", { id }, () =>
    fetchJson<OpenFolderResult>(`/api/open/${encodeURIComponent(id)}`, {
      method: "POST",
    }),
  );
}

export function openPath(path: string): Promise<OpenFolderResult> {
  return invoke<OpenFolderResult>("open_path", { path });
}

export function getWizTreeStatus(): Promise<WizTreeStatus> {
  return invokeOrFallback("get_wiztree_status", {}, async () => ({
    available: false,
    canDownload: false,
    message: "Manajemen WizTree hanya tersedia di desktop build Tauri.",
    source: "browser",
  }));
}

export function pickWizTreeExe(): Promise<WizTreeStatus> {
  return invoke<WizTreeStatus>("pick_wiztree_exe");
}

export function downloadWizTree(): Promise<WizTreeStatus> {
  return invoke<WizTreeStatus>("download_wiztree");
}
