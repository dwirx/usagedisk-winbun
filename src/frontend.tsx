import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { getErrorMessage } from "./error";
import "./index.css";
import type {
  CleanResult,
  DiskInfo,
  OpenFolderResult,
  SafeLevel,
  ScannedTarget,
  Target,
} from "./types";

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("id-ID");
}

function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString("id-ID", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    second: "2-digit",
    year: "numeric",
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request gagal (${response.status})`);
  }
  return (await response.json()) as T;
}

const SAFE_MAP: Record<SafeLevel, { label: string; cls: string }> = {
  safe: { label: "✅ Aman Dihapus", cls: "badge-safe" },
  conditional: { label: "⚠️ Periksa Dulu", cls: "badge-warn" },
  unsafe: { label: "🚫 Jangan Hapus", cls: "badge-danger" },
};

const CATEGORY_ORDER = [
  "System Cache",
  "User Files",
  "Dev Cache",
  "App Cache",
  "Browser Cache",
  "Virtual Machine",
  "Game Cache",
  "System Trash",
] as const;

const SAFE_ORDER: Record<SafeLevel, number> = {
  safe: 0,
  conditional: 1,
  unsafe: 2,
};

interface ScanSummary {
  checked: number;
  found: number;
  missing: number;
  inaccessible: number;
  skippedItems: number;
  startedAt: number | null;
  finishedAt: number | null;
}

interface CleanProgressProps {
  total: number;
  current: number;
  currentName: string;
  done: boolean;
  results: CleanResult[];
  totalFreed: number;
  onClose: () => void;
}

interface ConfirmModalProps {
  items: ScannedTarget[];
  totalSize: number;
  onConfirm: () => void;
  onCancel: () => void;
}

interface CleanBarProps {
  selected: ScannedTarget[];
  allSafeCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onClean: () => void;
}

interface RowProps {
  item: ScannedTarget;
  isExpanded: boolean;
  isSelected: boolean;
  isOpening: boolean;
  onToggle: () => void;
  onCheck: () => void;
  onOpenFolder: () => void;
}

type SortBy = "name" | "safe" | "size";
type SafetyFilter = "all" | SafeLevel;
type MinSizeFilter = 0 | 100 | 500 | 1024;

type CleanStreamEvent =
  | { type: "start"; total: number }
  | { type: "progress"; current: number; id: string; name: string }
  | { type: "result"; current: number; id: string; result: CleanResult }
  | { type: "done" };

const EMPTY_SCAN_SUMMARY: ScanSummary = {
  checked: 0,
  found: 0,
  inaccessible: 0,
  missing: 0,
  skippedItems: 0,
  startedAt: null,
  finishedAt: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseCleanStreamEvent(payload: unknown): CleanStreamEvent | null {
  const record = asRecord(payload);
  if (!record || typeof record.type !== "string") {
    return null;
  }

  switch (record.type) {
    case "start":
      if (typeof record.total !== "number") {
        return null;
      }
      return { type: "start", total: record.total };
    case "progress":
      if (
        typeof record.current !== "number" ||
        typeof record.id !== "string" ||
        typeof record.name !== "string"
      ) {
        return null;
      }
      return {
        type: "progress",
        current: record.current,
        id: record.id,
        name: record.name,
      };
    case "result":
      if (
        typeof record.current !== "number" ||
        typeof record.id !== "string" ||
        !asRecord(record.result)
      ) {
        return null;
      }
      return {
        type: "result",
        current: record.current,
        id: record.id,
        result: record.result as CleanResult,
      };
    case "done":
      return { type: "done" };
    default:
      return null;
  }
}

const DiskUsageBar = memo(function DiskUsageBar({
  total,
  free,
  bloat,
}: {
  total: number;
  free: number;
  bloat: number;
}) {
  if (total <= 0) {
    return null;
  }

  const used = total - free;
  const usedPct = (used / total) * 100;
  const bloatPct = Math.min((bloat / total) * 100, usedPct);
  const freePct = (free / total) * 100;

  return (
    <div className="disk-bar-wrap">
      <div className="disk-bar-label">
        <span>💾 Drive C</span>
        <span className="disk-bar-nums">
          <span className="used-txt">{formatBytes(used)} dipakai</span>
          <span className="sep">·</span>
          <span className="free-txt">{formatBytes(free)} bebas</span>
          <span className="sep">·</span>
          <span className="total-txt">{formatBytes(total)} total</span>
        </span>
      </div>
      <div className="disk-bar-track">
        <div
          className="disk-bar-used"
          style={{ width: `${usedPct - bloatPct}%` }}
        />
        <div
          className="disk-bar-bloat"
          style={{ width: `${bloatPct}%` }}
          title={`${formatBytes(bloat)} terdeteksi sebagai sampah`}
        />
        <div className="disk-bar-free" style={{ width: `${freePct}%` }} />
      </div>
      <div className="disk-bar-legend">
        <span>
          <i className="dot dot-used" />
          Terpakai ({usedPct.toFixed(1)}%)
        </span>
        <span>
          <i className="dot dot-bloat" />
          Sampah ({bloatPct.toFixed(1)}%)
        </span>
        <span>
          <i className="dot dot-free" />
          Kosong ({freePct.toFixed(1)}%)
        </span>
      </div>
    </div>
  );
});

const SeverityBar = memo(function SeverityBar({ size }: { size: number }) {
  const max = 5 * 1024 * 1024 * 1024;
  const pct = Math.min((size / max) * 100, 100);
  const color = pct > 60 ? "#ef4444" : pct > 20 ? "#f59e0b" : "#22c55e";

  return (
    <div className="sev-track">
      <div
        className="sev-fill"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
});

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        setCopied(false);
      });
  }, [text]);

  return (
    <button className="copy-btn" onClick={copy} title="Salin perintah">
      {copied ? "✅ Disalin!" : "📋 Salin"}
    </button>
  );
}

function CleanProgress({
  total,
  current,
  currentName,
  done,
  results,
  totalFreed,
  onClose,
}: CleanProgressProps) {
  const pct =
    total === 0 ? 0 : Math.min(100, Math.round((current / total) * 100));

  return (
    <div className="modal-overlay" onClick={done ? onClose : undefined}>
      <div
        className="modal-box modal-box-wide"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-icon">{done ? "✅" : "🧹"}</div>
        <h2 className="modal-title">
          {done ? "Pembersihan Selesai!" : "Sedang Membersihkan..."}
        </h2>

        {!done && (
          <p className="modal-subtitle">
            Mengerjakan <strong>{currentName || "target terpilih"}</strong> -{" "}
            {current} / {total} folder
          </p>
        )}
        {done && (
          <p className="modal-subtitle">
            Berhasil membebaskan{" "}
            <strong className="modal-size">{formatBytes(totalFreed)}</strong>{" "}
            dari{" "}
            <strong>
              {formatNumber(
                results.reduce((sum, result) => sum + result.deletedFiles, 0),
              )}{" "}
              file
            </strong>
            .
          </p>
        )}

        <div className="clean-prog-wrap">
          <div className="clean-prog-track">
            <div
              className={`clean-prog-fill ${done ? "clean-prog-done" : ""}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="clean-prog-pct">{pct}%</span>
        </div>

        <div className="modal-list clean-result-list">
          {results.length === 0 && !done && (
            <div className="clean-waiting">⏳ Mempersiapkan...</div>
          )}
          {results.map((result) => (
            <div
              key={result.id}
              className={`modal-item ${result.success ? "modal-item-ok" : "modal-item-fail"}`}
            >
              <span className="modal-item-icon">
                {result.success ? "✅" : "❌"}
              </span>
              <div className="modal-item-info">
                <span className="modal-item-name">{result.name}</span>
                <span className="modal-item-size">
                  {result.success
                    ? `-${formatBytes(result.freedBytes)} · ${formatNumber(result.deletedFiles)} file dihapus`
                    : (result.errors[0] ?? "gagal")}
                </span>
              </div>
            </div>
          ))}
        </div>

        {done && results.some((result) => result.errors.length > 0) && (
          <div className="modal-warn">
            ℹ️ Beberapa file tidak bisa dihapus karena sedang dipakai sistem.
            Ini normal.
          </div>
        )}

        {done && (
          <div className="modal-actions" style={{ justifyContent: "center" }}>
            <button className="btn-confirm" onClick={onClose}>
              Tutup &amp; Perbarui Data
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const ConfirmModal = memo(function ConfirmModal({
  items,
  totalSize,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="modal-icon">🧹</div>
        <h2 className="modal-title">Konfirmasi Pembersihan</h2>
        <p className="modal-subtitle">
          Anda akan membersihkan <strong>{items.length} folder</strong> dan
          membebaskan sekitar{" "}
          <strong className="modal-size">{formatBytes(totalSize)}</strong>.
        </p>

        <div className="modal-list">
          {items.map((item) => (
            <div key={item.id} className="modal-item">
              <span className="modal-item-icon">{item.icon}</span>
              <div className="modal-item-info">
                <span className="modal-item-name">{item.name}</span>
                <span className="modal-item-size">
                  {formatBytes(item.size)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-warn">
          ⚠️ File yang sudah dibersihkan{" "}
          <strong>tidak bisa dikembalikan</strong>. Semua item berlabel{" "}
          <strong>Aman Dihapus</strong> telah diverifikasi aman.
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>
            Batalkan
          </button>
          <button className="btn-confirm" onClick={onConfirm}>
            🗑️ Ya, Bersihkan Sekarang
          </button>
        </div>
      </div>
    </div>
  );
});

const CleanBar = memo(function CleanBar({
  selected,
  allSafeCount,
  onSelectAll,
  onDeselectAll,
  onClean,
}: CleanBarProps) {
  if (allSafeCount === 0) {
    return null;
  }

  const totalSize = selected.reduce((sum, row) => sum + row.size, 0);
  return (
    <div
      className={`clean-bar ${selected.length > 0 ? "clean-bar-active" : ""}`}
    >
      <div className="clean-bar-inner">
        <div className="clean-bar-left">
          <span className="clean-bar-count">
            {selected.length > 0
              ? `${selected.length} folder dipilih · ${formatBytes(totalSize)}`
              : `${allSafeCount} folder aman tersedia untuk dibersihkan`}
          </span>
          <div className="clean-bar-btns">
            <button className="cb-btn" onClick={onSelectAll}>
              ✅ Pilih Semua Aman
            </button>
            {selected.length > 0 && (
              <button className="cb-btn cb-btn-ghost" onClick={onDeselectAll}>
                Batalkan Pilihan
              </button>
            )}
          </div>
        </div>
        <button
          className="btn-clean"
          disabled={selected.length === 0}
          onClick={onClean}
        >
          🧹 Bersihkan{selected.length > 0 ? ` (${selected.length})` : ""}
        </button>
      </div>
    </div>
  );
});

const ResultRow = memo(function ResultRow({
  item,
  isExpanded,
  isSelected,
  isOpening,
  onToggle,
  onCheck,
  onOpenFolder,
}: RowProps) {
  const canSelect = item.safeToDelete === "safe";
  const isBig = item.size > 500 * 1024 * 1024;
  const isMed = item.size > 100 * 1024 * 1024;
  const rowClass = `row ${isBig ? "row-danger" : isMed ? "row-warn" : "row-ok"} ${
    isSelected ? "row-selected" : ""
  }`;

  return (
    <div className={rowClass}>
      <div className="row-hd">
        <div
          className={`row-check ${canSelect ? "row-check-enabled" : "row-check-disabled"}`}
          onClick={canSelect ? onCheck : undefined}
          title={
            canSelect
              ? "Pilih untuk dibersihkan"
              : "Hanya label 'Aman Dihapus' yang bisa dipilih"
          }
        >
          <div className={`checkbox ${isSelected ? "checkbox-checked" : ""}`}>
            {isSelected && <span>✓</span>}
          </div>
        </div>

        <div className="row-left" onClick={onToggle}>
          <span className="row-icon">{item.icon}</span>
          <div className="row-meta">
            <span className="row-name">{item.name}</span>
            <span className="row-type">{item.type}</span>
          </div>
        </div>

        <div className="row-right" onClick={onToggle}>
          <span className={`badge ${SAFE_MAP[item.safeToDelete].cls}`}>
            {SAFE_MAP[item.safeToDelete].label}
          </span>
          <div className="row-size-col">
            <span className="row-size">{formatBytes(item.size)}</span>
            <SeverityBar size={item.size} />
            {item.files > 0 && (
              <span className="row-files">{formatNumber(item.files)} file</span>
            )}
            {item.skippedItems > 0 && (
              <span className="row-files row-files-warn">
                {formatNumber(item.skippedItems)} item tidak terbaca
              </span>
            )}
          </div>
          <span className="chevron">{isExpanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {isExpanded && (
        <div className="detail">
          <div className="detail-grid">
            <div className="detail-block">
              <div className="detail-lbl">📂 Lokasi</div>
              <code className="detail-path">{item.path}</code>
              <div className="detail-actions">
                <button
                  className="btn-open-folder"
                  disabled={isOpening}
                  onClick={onOpenFolder}
                >
                  {isOpening ? "⏳ Membuka..." : "📂 Buka Folder"}
                </button>
                <CopyBtn text={item.path} />
              </div>
            </div>
            <div className="detail-block">
              <div className="detail-lbl">📖 Penjelasan</div>
              <p className="detail-txt">{item.description}</p>
            </div>
            <div className="detail-block">
              <div className="detail-lbl">
                {item.safeToDelete === "safe"
                  ? "✅ Status: Aman Dihapus"
                  : item.safeToDelete === "conditional"
                    ? "⚠️ Status: Perlu Hati-hati"
                    : "🚫 Status: Jangan Hapus Sembarangan"}
              </div>
              <p className="detail-txt">{item.safeNote}</p>
            </div>
            {item.scanNote && (
              <div className="detail-block">
                <div className="detail-lbl">🔍 Catatan Scan</div>
                <p className="detail-txt">{item.scanNote}</p>
              </div>
            )}
            {item.cleanCommand && (
              <div className="detail-block">
                <div className="detail-lbl">🧹 Cara Membersihkan</div>
                <div className="cmd-row">
                  <code className="detail-cmd">{item.cleanCommand}</code>
                  <CopyBtn text={item.cleanCommand} />
                </div>
                {canSelect && (
                  <button
                    className={`btn-quick-clean ${isSelected ? "btn-quick-clean-active" : ""}`}
                    onClick={onCheck}
                  >
                    {isSelected
                      ? "✓ Dipilih untuk Dibersihkan"
                      : "+ Pilih untuk Dibersihkan"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default function App() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [results, setResults] = useState<ScannedTarget[]>([]);
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 1 });
  const [scanningName, setScanningName] = useState("");
  const [scanSummary, setScanSummary] =
    useState<ScanSummary>(EMPTY_SCAN_SUMMARY);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [activeTab, setActiveTab] = useState("Semua");
  const [sortBy, setSortBy] = useState<SortBy>("size");
  const [searchQuery, setSearchQuery] = useState("");
  const [safeFilter, setSafeFilter] = useState<SafetyFilter>("all");
  const [minSizeFilter, setMinSizeFilter] = useState<MinSizeFilter>(0);
  const [openingFolderId, setOpeningFolderId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [cleanCurrent, setCleanCurrent] = useState(0);
  const [cleanTotal, setCleanTotal] = useState(0);
  const [cleanName, setCleanName] = useState("");
  const [cleanDone, setCleanDone] = useState(false);
  const [cleanResults, setCleanResults] = useState<CleanResult[]>([]);
  const [cleanFreed, setCleanFreed] = useState(0);

  const categories = useMemo(() => {
    const allTypes = new Set(targets.map((target) => target.type));
    const sortedTypes = Array.from(allTypes).sort((left, right) => {
      const leftPriority = CATEGORY_ORDER.indexOf(
        left as (typeof CATEGORY_ORDER)[number],
      );
      const rightPriority = CATEGORY_ORDER.indexOf(
        right as (typeof CATEGORY_ORDER)[number],
      );

      if (leftPriority === -1 && rightPriority === -1) {
        return left.localeCompare(right);
      }
      if (leftPriority === -1) {
        return 1;
      }
      if (rightPriority === -1) {
        return -1;
      }
      return leftPriority - rightPriority;
    });

    return ["Semua", ...sortedTypes];
  }, [targets]);

  const refreshDisk = useCallback(async () => {
    try {
      const data = await fetchJson<DiskInfo>("/api/diskinfo");
      setDiskInfo(data);
    } catch (error) {
      setNotice(getErrorMessage(error, "Gagal mengambil informasi disk."));
    }
  }, []);

  const openFolder = useCallback(async (targetId: string) => {
    setOpeningFolderId(targetId);
    try {
      const response = await fetch(
        `/api/open/${encodeURIComponent(targetId)}`,
        {
          method: "POST",
        },
      );
      const body = (await response.json()) as
        | OpenFolderResult
        | { error?: string; message?: string };

      if (!response.ok) {
        const failureMessage =
          ("error" in body && typeof body.error === "string" && body.error) ||
          ("message" in body &&
            typeof body.message === "string" &&
            body.message) ||
          "Gagal membuka folder.";
        setNotice(`❌ ${failureMessage}`);
        return;
      }

      if ("message" in body && typeof body.message === "string") {
        setNotice(`✅ ${body.message}`);
      } else {
        setNotice("✅ Folder berhasil dibuka.");
      }
    } catch (error) {
      setNotice(`❌ ${getErrorMessage(error, "Gagal membuka folder.")}`);
    } finally {
      setOpeningFolderId(null);
    }
  }, []);

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const loadedTargets = await fetchJson<Target[]>("/api/targets");
        setTargets(loadedTargets);
      } catch (error) {
        setNotice(
          getErrorMessage(error, "Gagal memuat daftar target pemindaian."),
        );
      }
      await refreshDisk();
    };

    void loadInitial();
  }, [refreshDisk]);

  const startScan = useCallback(async () => {
    if (targets.length === 0) {
      setNotice("Daftar target belum tersedia, coba beberapa detik lagi.");
      return;
    }

    setNotice(null);
    setScanning(true);
    setDone(false);
    setExpanded(null);
    setResults([]);
    setSelected(new Set());
    setProgress({ current: 0, total: targets.length });

    const nextSummary: ScanSummary = {
      checked: 0,
      found: 0,
      inaccessible: 0,
      missing: 0,
      skippedItems: 0,
      startedAt: Date.now(),
      finishedAt: null,
    };
    setScanSummary(nextSummary);

    const discovered: ScannedTarget[] = [];
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      if (!target) {
        continue;
      }
      setScanningName(target.name);

      try {
        const scanned = await fetchJson<ScannedTarget>(
          `/api/scan/${encodeURIComponent(target.id)}`,
        );
        if (scanned.scanStatus === "missing") {
          nextSummary.missing++;
        } else if (scanned.scanStatus === "inaccessible") {
          nextSummary.inaccessible++;
        }

        nextSummary.skippedItems += scanned.skippedItems;
        if (scanned.size > 0 || scanned.scanStatus === "inaccessible") {
          discovered.push(scanned);
        }
        if (scanned.size > 0) {
          nextSummary.found++;
        }
      } catch (error) {
        nextSummary.inaccessible++;
        setNotice(getErrorMessage(error, "Sebagian target gagal dipindai."));
      }

      nextSummary.checked = index + 1;
      setProgress({ current: index + 1, total: targets.length });
      setResults(
        discovered.slice().sort((left, right) => right.size - left.size),
      );
      setScanSummary({ ...nextSummary });
    }

    nextSummary.finishedAt = Date.now();
    setScanSummary({ ...nextSummary });
    setScanning(false);
    setScanningName("");
    setDone(true);
    await refreshDisk();
  }, [refreshDisk, targets]);

  const doClean = useCallback(async () => {
    if (selected.size === 0) {
      return;
    }

    setShowConfirm(false);
    const ids = Array.from(selected);
    setSelected(new Set());
    setShowProgress(true);
    setCleanDone(false);
    setCleanResults([]);
    setCleanFreed(0);
    setCleanCurrent(0);
    setCleanTotal(ids.length);
    setCleanName("");

    try {
      const response = await fetch("/api/clean/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });

      if (!response.ok) {
        throw new Error(`Gagal memulai pembersihan (${response.status})`);
      }
      if (!response.body) {
        throw new Error("Streaming progress tidak tersedia");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let freedAccumulator = 0;

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data: ")) {
            continue;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          const event = parseCleanStreamEvent(parsed);
          if (!event) {
            continue;
          }

          if (event.type === "start") {
            setCleanTotal(event.total);
            continue;
          }
          if (event.type === "progress") {
            setCleanCurrent(event.current - 1);
            setCleanName(event.name);
            continue;
          }
          if (event.type === "result") {
            freedAccumulator += event.result.freedBytes;
            setCleanCurrent(event.current);
            setCleanFreed(freedAccumulator);
            setCleanResults((previous) => [...previous, event.result]);
            continue;
          }
          if (event.type === "done") {
            setCleanDone(true);
          }
        }
      }
      setCleanDone(true);
    } catch (error) {
      setNotice(getErrorMessage(error, "Pembersihan gagal dijalankan."));
      setCleanDone(true);
    }
  }, [selected]);

  const afterCleanClose = useCallback(() => {
    setShowProgress(false);
    void refreshDisk();
    if (done) {
      void startScan();
    }
  }, [done, refreshDisk, startScan]);

  const pct =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;
  const totalBloat = results.reduce((sum, row) => sum + row.size, 0);
  const totalFiles = results.reduce((sum, row) => sum + row.files, 0);
  const safeItems = results.filter((row) => row.safeToDelete === "safe");
  const safeToFree = safeItems.reduce((sum, row) => sum + row.size, 0);
  const minBytes = minSizeFilter === 0 ? 0 : minSizeFilter * 1024 * 1024;
  const topSafeCandidates = safeItems
    .slice()
    .sort((left, right) => right.size - left.size)
    .slice(0, 5);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = results
    .filter((row) => activeTab === "Semua" || row.type === activeTab)
    .filter((row) => safeFilter === "all" || row.safeToDelete === safeFilter)
    .filter((row) => row.size >= minBytes)
    .filter((row) => {
      if (normalizedQuery.length === 0) {
        return true;
      }
      return (
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.path.toLowerCase().includes(normalizedQuery) ||
        row.type.toLowerCase().includes(normalizedQuery)
      );
    })
    .sort((left, right) => {
      if (sortBy === "name") {
        return left.name.localeCompare(right.name);
      }
      if (sortBy === "safe") {
        return SAFE_ORDER[left.safeToDelete] - SAFE_ORDER[right.safeToDelete];
      }
      return right.size - left.size;
    });

  const toggleSelect = useCallback((id: string, safeToDelete: SafeLevel) => {
    if (safeToDelete !== "safe") {
      return;
    }
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectOneSafe = useCallback(
    (id: string) => {
      const target = results.find((item) => item.id === id);
      if (!target || target.safeToDelete !== "safe") {
        return;
      }
      setSelected((previous) => {
        if (previous.has(id)) {
          return previous;
        }
        const next = new Set(previous);
        next.add(id);
        return next;
      });
    },
    [results],
  );

  const selectAll = useCallback(() => {
    setSelected(new Set(safeItems.map((item) => item.id)));
  }, [safeItems]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedItems = results.filter((item) => selected.has(item.id));
  const selectedSize = selectedItems.reduce((sum, item) => sum + item.size, 0);

  const diag = (() => {
    if (!done) {
      return null;
    }
    if (totalBloat === 0) {
      return {
        level: "green",
        msg: "Drive C Anda bersih. Tidak ada sampah terdeteksi.",
      };
    }

    const gb = totalBloat / 1024 ** 3;
    if (gb > 10) {
      return {
        level: "red",
        msg: `Kritis. ${formatBytes(totalBloat)} sampah ditemukan. Segera bersihkan.`,
      };
    }
    if (gb > 2) {
      return {
        level: "yellow",
        msg: `Perhatian. ${formatBytes(totalBloat)} sampah ditemukan.`,
      };
    }
    return {
      level: "green",
      msg: `Aman. Hanya ${formatBytes(totalBloat)} sampah terdeteksi.`,
    };
  })();

  return (
    <div className="app">
      {showConfirm && (
        <ConfirmModal
          items={selectedItems}
          totalSize={selectedSize}
          onConfirm={doClean}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {showProgress && (
        <CleanProgress
          total={cleanTotal}
          current={cleanCurrent}
          currentName={cleanName}
          done={cleanDone}
          results={cleanResults}
          totalFreed={cleanFreed}
          onClose={afterCleanClose}
        />
      )}

      <header className="hdr">
        <div className="hdr-inner">
          <div className="hdr-brand">
            <span className="hdr-logo">🩺</span>
            <div>
              <h1>Dokter Storage C</h1>
              <p>
                Deteksi penyebab Drive C penuh · Bersihkan langsung dari browser
              </p>
            </div>
          </div>
          <button
            className="btn-scan"
            onClick={startScan}
            disabled={scanning || showProgress}
          >
            {scanning
              ? `⏳ Memindai... ${pct}%`
              : done
                ? "🔁 Scan Ulang"
                : "🔍 Mulai Pemindaian"}
          </button>
        </div>
      </header>

      <main className="main">
        {notice && (
          <div className="notice notice-warn">
            <strong>Catatan:</strong> {notice}
          </div>
        )}

        {diskInfo && diskInfo.total > 0 && (
          <DiskUsageBar
            total={diskInfo.total}
            free={diskInfo.free}
            bloat={totalBloat}
          />
        )}

        {scanning && (
          <div className="progress-card">
            <div className="progress-top">
              <span>
                🔎 Menganalisis: <strong>{scanningName}</strong>
              </span>
              <span className="prog-pct">{pct}%</span>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="prog-sub">
              {progress.current} / {progress.total} folder diperiksa
            </p>
          </div>
        )}

        {diag && (
          <div className={`verdict verdict-${diag.level}`}>
            <span className="verdict-icon">
              {diag.level === "red"
                ? "🚨"
                : diag.level === "yellow"
                  ? "⚠️"
                  : "✅"}
            </span>
            <span>{diag.msg}</span>
          </div>
        )}

        {done && (
          <div className="scan-summary">
            <div className="scan-summary-grid">
              <div className="scan-chip">
                <span>Diperiksa</span>
                <strong>
                  {formatNumber(scanSummary.checked)} /{" "}
                  {formatNumber(targets.length)}
                </strong>
              </div>
              <div className="scan-chip">
                <span>Ditemukan</span>
                <strong>{formatNumber(scanSummary.found)}</strong>
              </div>
              <div className="scan-chip">
                <span>Tidak Ada</span>
                <strong>{formatNumber(scanSummary.missing)}</strong>
              </div>
              <div className="scan-chip">
                <span>Akses Terbatas</span>
                <strong>{formatNumber(scanSummary.inaccessible)}</strong>
              </div>
              <div className="scan-chip">
                <span>Item Terlewati</span>
                <strong>{formatNumber(scanSummary.skippedItems)}</strong>
              </div>
            </div>
            {scanSummary.finishedAt && (
              <p className="scan-summary-time">
                Scan selesai: {formatDateTime(scanSummary.finishedAt)}
              </p>
            )}
          </div>
        )}

        {results.length > 0 && (
          <div className="cards">
            <div className="card card-red">
              <div className="card-lbl">Total Sampah</div>
              <div className="card-val">{formatBytes(totalBloat)}</div>
              <div className="card-sub">{formatNumber(totalFiles)} file</div>
            </div>
            <div className="card card-green">
              <div className="card-lbl">Aman Dihapus</div>
              <div className="card-val">{formatBytes(safeToFree)}</div>
              <div className="card-sub">{safeItems.length} folder</div>
            </div>
            <div className="card card-yellow">
              <div className="card-lbl">Perlu Diperiksa</div>
              <div className="card-val">
                {
                  results.filter(
                    (result) => result.safeToDelete === "conditional",
                  ).length
                }
              </div>
              <div className="card-sub">folder hati-hati</div>
            </div>
            <div className="card card-blue">
              <div className="card-lbl">Akses Terbatas</div>
              <div className="card-val">
                {formatNumber(scanSummary.inaccessible)}
              </div>
              <div className="card-sub">target tidak bisa dibaca</div>
            </div>
          </div>
        )}

        {done && topSafeCandidates.length > 0 && (
          <section className="priority-panel">
            <div className="priority-head">
              <h3>🎯 Prioritas Aman Terbesar</h3>
              <span>{topSafeCandidates.length} kandidat teratas</span>
            </div>
            <div className="priority-list">
              {topSafeCandidates.map((item, index) => (
                <div key={item.id} className="priority-item">
                  <div className="priority-left">
                    <span className="priority-rank">#{index + 1}</span>
                    <span className="priority-name">
                      {item.icon} {item.name}
                    </span>
                  </div>
                  <div className="priority-right">
                    <span className="priority-size">
                      {formatBytes(item.size)}
                    </span>
                    <button
                      className="sort-btn"
                      onClick={() => {
                        setExpanded(item.id);
                        selectOneSafe(item.id);
                      }}
                    >
                      Pilih
                    </button>
                    <button
                      className="sort-btn"
                      onClick={() => void openFolder(item.id)}
                    >
                      Buka Folder
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {results.length > 0 && (
          <section className="results">
            <div className="toolbar">
              <div className="tabs">
                {categories.map((category) => (
                  <button
                    key={category}
                    className={`tab ${activeTab === category ? "tab-active" : ""}`}
                    onClick={() => setActiveTab(category)}
                  >
                    {category}
                    {category !== "Semua" && (
                      <span className="tab-count">
                        {
                          results.filter((result) => result.type === category)
                            .length
                        }
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="toolbar-extra">
                <input
                  className="search-input"
                  placeholder="Cari nama folder, path, atau kategori..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                <div className="safe-filters">
                  {(
                    [
                      ["all", "Semua Status"],
                      ["safe", "Aman"],
                      ["conditional", "Hati-hati"],
                      ["unsafe", "Bahaya"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={`sort-btn ${safeFilter === value ? "sort-active" : ""}`}
                      onClick={() => setSafeFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="safe-filters">
                  {(
                    [
                      [0, "Semua Ukuran"],
                      [100, ">= 100 MB"],
                      [500, ">= 500 MB"],
                      [1024, ">= 1 GB"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={`sort-btn ${minSizeFilter === value ? "sort-active" : ""}`}
                      onClick={() => setMinSizeFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sort-row">
                <span className="sort-lbl">Urutkan:</span>
                {(["size", "name", "safe"] as const).map((value) => (
                  <button
                    key={value}
                    className={`sort-btn ${sortBy === value ? "sort-active" : ""}`}
                    onClick={() => setSortBy(value)}
                  >
                    {value === "size"
                      ? "Ukuran"
                      : value === "name"
                        ? "Nama"
                        : "Keamanan"}
                  </button>
                ))}
              </div>
            </div>

            <div className="results-hd">
              <h2>
                📋 Hasil Pemindaian{" "}
                {scanning ? (
                  <span className="tag-live">Live</span>
                ) : (
                  <span className="tag-done">
                    Selesai · {filtered.length} item
                  </span>
                )}
              </h2>
              {done && safeItems.length > 0 && (
                <p className="results-hint">
                  💡 Centang item berlabel{" "}
                  <span className="hint-safe">Aman Dihapus</span> lalu klik{" "}
                  <strong>Bersihkan</strong> di bawah. Anda juga bisa klik{" "}
                  <strong>Buka Folder</strong> pada detail item.
                </p>
              )}
            </div>

            <div className="list">
              {filtered.map((item) => (
                <ResultRow
                  key={item.id}
                  item={item}
                  isExpanded={expanded === item.id}
                  isSelected={selected.has(item.id)}
                  isOpening={openingFolderId === item.id}
                  onToggle={() =>
                    setExpanded(expanded === item.id ? null : item.id)
                  }
                  onCheck={() => toggleSelect(item.id, item.safeToDelete)}
                  onOpenFolder={() => void openFolder(item.id)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="no-results">
                  Tidak ada hasil untuk filter saat ini di kategori{" "}
                  <strong>{activeTab}</strong>
                </div>
              )}
            </div>
          </section>
        )}

        {!scanning && !done && (
          <div className="empty">
            <div className="empty-icon">🩺</div>
            <h2>Siap Mendiagnosis Drive C</h2>
            <p>
              Klik <strong>Mulai Pemindaian</strong> di atas.
              <br />
              Hasil muncul <em>realtime</em> satu per satu.
            </p>
          </div>
        )}

        {done && results.length === 0 && (
          <div className="empty">
            <div className="empty-icon">✨</div>
            <h2>Tidak ada folder besar terdeteksi</h2>
            <p>
              Target berhasil dipindai, tetapi tidak ada folder cache signifikan
              yang perlu dibersihkan saat ini.
            </p>
          </div>
        )}
      </main>

      {done && !showProgress && (
        <CleanBar
          selected={selectedItems}
          allSafeCount={safeItems.length}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onClean={() => setShowConfirm(true)}
        />
      )}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
