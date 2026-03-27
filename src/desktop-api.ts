import { invoke } from "@tauri-apps/api/core";

import type {
  CleanResult,
  DiskInfo,
  OpenFolderResult,
  ScannedTarget,
  Target,
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
