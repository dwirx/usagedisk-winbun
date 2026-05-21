import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import {
  cancelScanJob as cancelScanJobDesktop,
  cleanTarget as cleanTargetDesktop,
  getDiskInfo as getDiskInfoDesktop,
  getTargets as getTargetsDesktop,
  isDesktopRuntime,
  listenScanEvents,
  openPath as openPathDesktop,
  openTargetFolder as openTargetFolderDesktop,
  scanTarget as scanTargetDesktop,
  startScanJob as startScanJobDesktop,
} from "./desktop-api";
import { getErrorMessage } from "./error";
import "./index.css";
import type {
  AdvisoryFinding,
  CleanResult,
  DiskInfo,
  DriveAnalysisSummary,
  LargestItem,
  Recommendation,
  RiskLevel,
  SafeLevel,
  ScanJobEvent,
  ScanPhase,
  ScannedTarget,
  StorageNode,
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

const SAFE_MAP: Record<SafeLevel, { label: string; cls: string }> = {
  safe: { label: "✅ Aman Dihapus", cls: "badge-safe" },
  conditional: { label: "⚠️ Periksa Dulu", cls: "badge-warn" },
  unsafe: { label: "🚫 Jangan Hapus", cls: "badge-danger" },
};

const RECOMMENDATION_MAP: Record<
  Recommendation,
  { label: string; cls: string }
> = {
  clean_now: {
    label: "🧹 Siap Dibersihkan",
    cls: "badge-rec-clean",
  },
  review_first: {
    label: "🔎 Review Dulu",
    cls: "badge-rec-review",
  },
  manual_only: {
    label: "✋ Manual Saja",
    cls: "badge-rec-manual",
  },
  unavailable: {
    label: "⛔ Belum Bisa Dicek",
    cls: "badge-rec-unavailable",
  },
};

const RISK_MAP: Record<RiskLevel, { label: string; cls: string }> = {
  low: { label: "Risiko Rendah", cls: "risk-low" },
  medium: { label: "Risiko Sedang", cls: "risk-medium" },
  high: { label: "Risiko Tinggi", cls: "risk-high" },
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

const RECOMMENDATION_ORDER: Record<Recommendation, number> = {
  clean_now: 0,
  review_first: 1,
  manual_only: 2,
  unavailable: 3,
};

interface ScanSummary {
  checked: number;
  found: number;
  missing: number;
  inaccessible: number;
  skippedItems: number;
  advisories: number;
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

type SortBy = "name" | "recommendation" | "size";
type SafetyFilter = "all" | SafeLevel;
type MinSizeFilter = 0 | 100 | 500 | 1024;
type AnalyzerTab = "treemap" | "files" | "folders";

const EMPTY_SCAN_SUMMARY: ScanSummary = {
  checked: 0,
  found: 0,
  inaccessible: 0,
  missing: 0,
  skippedItems: 0,
  advisories: 0,
  startedAt: null,
  finishedAt: null,
};

const SCAN_PHASE_LABEL: Record<ScanPhase, string> = {
  quick: "Quick Scan",
  deep: "Deep Scan",
  diagnostics: "Diagnostics",
};

function shouldShowTarget(item: ScannedTarget): boolean {
  return item.size > 0 || item.availabilityStatus === "inaccessible";
}

function upsertScannedTarget(
  items: ScannedTarget[],
  incoming: ScannedTarget,
): ScannedTarget[] {
  const index = items.findIndex((item) => item.id === incoming.id);

  if (!shouldShowTarget(incoming)) {
    if (index === -1) {
      return items;
    }
    const next = items.slice();
    next.splice(index, 1);
    return next;
  }

  if (index === -1) {
    return [...items, incoming];
  }

  const next = items.slice();
  next[index] = incoming;
  return next;
}

function upsertStorageNodes(
  items: StorageNode[],
  incoming: StorageNode[],
): StorageNode[] {
  const next = new Map(items.map((item) => [item.id, item]));
  for (const item of incoming) {
    next.set(item.id, item);
  }
  return Array.from(next.values());
}

function tileBasis(size: number, total: number): string {
  if (total <= 0) {
    return "24%";
  }

  const pct = Math.max(14, Math.min(60, (size / total) * 100));
  return `${pct}%`;
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
            <div className="clean-waiting">⏳ Mempersiapkan verifikasi...</div>
          )}
          {results.map((result) => (
            <div
              key={result.id}
              className={`modal-item ${
                result.verificationStatus === "verified"
                  ? "modal-item-ok"
                  : result.verificationStatus === "partial"
                    ? "modal-item-warn"
                    : "modal-item-fail"
              }`}
            >
              <span className="modal-item-icon">
                {result.verificationStatus === "verified"
                  ? "✅"
                  : result.verificationStatus === "partial"
                    ? "⚠️"
                    : "⛔"}
              </span>
              <div className="modal-item-info">
                <span className="modal-item-name">{result.name}</span>
                <span className="modal-item-size">
                  {`${formatBytes(result.estimatedBytes)} → ${formatBytes(
                    result.remainingBytes,
                  )} · -${formatBytes(result.freedBytes)}`}
                </span>
                <span className="modal-item-note">
                  {result.verificationNote}
                </span>
                {result.errors.length > 0 && (
                  <span className="modal-item-note modal-item-note-warn">
                    {result.errors[0]}
                  </span>
                )}
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
        <div className="modal-icon">🧾</div>
        <h2 className="modal-title">Review Sebelum Membersihkan</h2>
        <p className="modal-subtitle">
          Anda akan membersihkan <strong>{items.length} folder</strong> yang
          sudah lolos preflight scan, dengan estimasi ruang kosong{" "}
          <strong className="modal-size">{formatBytes(totalSize)}</strong>.
        </p>

        <div className="modal-list">
          {items.map((item) => (
            <div key={item.id} className="modal-item">
              <span className="modal-item-icon">{item.icon}</span>
              <div className="modal-item-info">
                <span className="modal-item-name">{item.name}</span>
                <span className="modal-item-size">
                  {formatBytes(item.size)} · {item.reason}
                </span>
                <span className="modal-item-note">
                  Evidence: {formatNumber(item.files)} file ·{" "}
                  {item.evidence.skippedItems === 0
                    ? "tanpa item tertahan"
                    : `${formatNumber(item.evidence.skippedItems)} item tertahan`}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-warn">
          ⚠️ File yang sudah dibersihkan{" "}
          <strong>tidak bisa dikembalikan</strong>. Backend akan mengecek ulang
          setiap target tepat sebelum penghapusan, lalu memblok item yang
          kondisinya berubah.
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
              : `${allSafeCount} folder lolos preflight dan siap dibersihkan`}
          </span>
          <div className="clean-bar-btns">
            <button className="cb-btn" onClick={onSelectAll}>
              ✅ Pilih Semua Rekomendasi
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
          🧹 Review &amp; Clean
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
  const canSelect = item.recommendation === "clean_now";
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
              : "Hanya item berlabel 'Siap Dibersihkan' yang bisa dipilih"
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
          <span
            className={`badge ${RECOMMENDATION_MAP[item.recommendation].cls}`}
          >
            {RECOMMENDATION_MAP[item.recommendation].label}
          </span>
          <span className={`badge ${SAFE_MAP[item.safeToDelete].cls}`}>
            {SAFE_MAP[item.safeToDelete].label}
          </span>
          <span className={`risk-pill ${RISK_MAP[item.riskLevel].cls}`}>
            {RISK_MAP[item.riskLevel].label}
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
              <div className="detail-lbl">🧭 Keputusan Cleaner</div>
              <p className="detail-txt">{item.reason}</p>
              <div className="detail-actions">
                <span
                  className={`badge ${RECOMMENDATION_MAP[item.recommendation].cls}`}
                >
                  {RECOMMENDATION_MAP[item.recommendation].label}
                </span>
                <span className={`risk-pill ${RISK_MAP[item.riskLevel].cls}`}>
                  {RISK_MAP[item.riskLevel].label}
                </span>
              </div>
            </div>
            <div className="detail-block">
              <div className="detail-lbl">🛡️ Catatan Keamanan</div>
              <p className="detail-txt">{item.safeNote}</p>
            </div>
            <div className="detail-block">
              <div className="detail-lbl">🔬 Preflight Evidence</div>
              <div className="evidence-grid">
                <div className="evidence-item">
                  <span>Path</span>
                  <strong>
                    {item.evidence.pathExists ? "Ditemukan" : "Tidak Ada"}
                  </strong>
                </div>
                <div className="evidence-item">
                  <span>Akses</span>
                  <strong>
                    {item.evidence.readable ? "Bisa Dibaca" : "Tertahan"}
                  </strong>
                </div>
                <div className="evidence-item">
                  <span>Tipe</span>
                  <strong>
                    {item.evidence.isDirectory ? "Direktori" : "Tidak Valid"}
                  </strong>
                </div>
                <div className="evidence-item">
                  <span>Preflight</span>
                  <strong>
                    {item.evidence.preflightPassed ? "Lolos" : "Tertahan"}
                  </strong>
                </div>
                <div className="evidence-item">
                  <span>Estimasi</span>
                  <strong>{formatBytes(item.evidence.estimatedBytes)}</strong>
                </div>
                <div className="evidence-item">
                  <span>Skip</span>
                  <strong>{formatNumber(item.evidence.skippedItems)}</strong>
                </div>
              </div>
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
                      ? "✓ Masuk Batch Clean"
                      : "+ Tambahkan ke Batch Clean"}
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
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("quick");
  const [progress, setProgress] = useState({ current: 0, total: 1 });
  const [scanningName, setScanningName] = useState("");
  const [scanSummary, setScanSummary] =
    useState<ScanSummary>(EMPTY_SCAN_SUMMARY);
  const [advisories, setAdvisories] = useState<AdvisoryFinding[]>([]);
  const [driveSummary, setDriveSummary] = useState<DriveAnalysisSummary | null>(
    null,
  );
  const [storageNodes, setStorageNodes] = useState<StorageNode[]>([]);
  const [largestItems, setLargestItems] = useState<LargestItem[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [analyzerTab, setAnalyzerTab] = useState<AnalyzerTab>("treemap");
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
      const data = await getDiskInfoDesktop();
      setDiskInfo(data);
    } catch (error) {
      setNotice(getErrorMessage(error, "Gagal mengambil informasi disk."));
    }
  }, []);

  const openFolder = useCallback(async (targetId: string) => {
    setOpeningFolderId(targetId);
    try {
      const result = await openTargetFolderDesktop(targetId);
      if (!result.opened) {
        setNotice(`❌ ${result.message}`);
        return;
      }
      setNotice(`✅ ${result.message}`);
    } catch (error) {
      setNotice(`❌ ${getErrorMessage(error, "Gagal membuka folder.")}`);
    } finally {
      setOpeningFolderId(null);
    }
  }, []);

  const openScannedPath = useCallback(async (path: string) => {
    try {
      const result = await openPathDesktop(path);
      setNotice(
        result.opened ? `✅ ${result.message}` : `❌ ${result.message}`,
      );
    } catch (error) {
      setNotice(`❌ ${getErrorMessage(error, "Gagal membuka lokasi.")}`);
    }
  }, []);

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const loadedTargets = await getTargetsDesktop();
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

  const runLegacyScan = useCallback(async () => {
    const nextSummary: ScanSummary = {
      ...EMPTY_SCAN_SUMMARY,
      startedAt: Date.now(),
    };

    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      if (!target) {
        continue;
      }

      setScanPhase("quick");
      setScanningName(target.name);

      try {
        const scanned = await scanTargetDesktop(target.id);
        if (scanned.availabilityStatus === "missing") {
          nextSummary.missing++;
        } else if (scanned.availabilityStatus === "inaccessible") {
          nextSummary.inaccessible++;
        }

        nextSummary.skippedItems += scanned.skippedItems;
        if (scanned.size > 0) {
          nextSummary.found++;
        }

        startTransition(() => {
          setResults((previous) => upsertScannedTarget(previous, scanned));
        });
      } catch (error) {
        nextSummary.inaccessible++;
        setNotice(getErrorMessage(error, "Sebagian target gagal dipindai."));
      }

      nextSummary.checked = index + 1;
      setProgress({ current: index + 1, total: targets.length });
      setScanSummary({ ...nextSummary });
    }

    nextSummary.finishedAt = Date.now();
    setScanSummary({ ...nextSummary });
    setScanning(false);
    setScanningName("");
    setDone(true);
    await refreshDisk();
  }, [refreshDisk, targets]);

  const applyScanEvent = useCallback(
    async (
      event: ScanJobEvent,
      cleanup: () => Promise<void>,
      startedAt: number,
    ) => {
      if (event.phase) {
        setScanPhase(event.phase);
      }

      if (event.label) {
        setScanningName(event.label);
      }

      if (
        event.type === "started" ||
        event.type === "progress" ||
        event.type === "done" ||
        event.type === "cancelled"
      ) {
        setProgress((previous) => ({
          current: event.current ?? previous.current,
          total: event.total ?? (event.phase === "deep" ? 0 : previous.total),
        }));
      }

      if (event.type === "target" && event.item) {
        startTransition(() => {
          setResults((previous) => upsertScannedTarget(previous, event.item!));
        });
        return;
      }

      if (event.type === "advisory" && event.advisory) {
        startTransition(() => {
          setAdvisories((previous) =>
            previous.some((item) => item.id === event.advisory!.id)
              ? previous
              : [...previous, event.advisory!],
          );
        });
        return;
      }

      if (event.type === "storage_batch" && event.storageNodes) {
        startTransition(() => {
          setStorageNodes((previous) =>
            upsertStorageNodes(previous, event.storageNodes!),
          );
        });
        return;
      }

      if (event.type === "largest_batch" && event.largestItems) {
        startTransition(() => {
          setLargestItems(event.largestItems!);
        });
        return;
      }

      if (event.type === "drive_summary" && event.driveSummary) {
        setDriveSummary(event.driveSummary);
        return;
      }

      if (event.type === "done") {
        setScanSummary({
          checked: event.summary?.checked ?? results.length,
          found: event.summary?.found ?? 0,
          inaccessible: event.summary?.inaccessible ?? 0,
          missing: event.summary?.missing ?? 0,
          skippedItems: event.summary?.skippedItems ?? 0,
          advisories: event.summary?.advisories ?? advisories.length,
          startedAt,
          finishedAt: Date.now(),
        });
        setScanning(false);
        setScanningName("");
        setDone(true);
        setScanJobId(null);
        await cleanup();
        await refreshDisk();
        return;
      }

      if (event.type === "cancelled") {
        setNotice(event.message ?? "Scan dibatalkan.");
        setScanning(false);
        setScanningName("");
        setDone(false);
        setScanJobId(null);
        await cleanup();
        return;
      }

      if (event.type === "error") {
        setNotice(event.message ?? "Scan desktop gagal dijalankan.");
        setScanning(false);
        setScanningName("");
        setDone(false);
        setScanJobId(null);
        await cleanup();
      }
    },
    [advisories.length, refreshDisk, results.length, targets.length],
  );

  const startScan = useCallback(async () => {
    if (targets.length === 0) {
      setNotice("Daftar target belum tersedia, coba beberapa detik lagi.");
      return;
    }

    setNotice(null);
    setScanning(true);
    setScanJobId(null);
    setScanPhase("quick");
    setDone(false);
    setExpanded(null);
    setResults([]);
    setAdvisories([]);
    setDriveSummary(null);
    setStorageNodes([]);
    setLargestItems([]);
    setSelectedNodeId(null);
    setAnalyzerTab("treemap");
    setSelected(new Set());
    setProgress({ current: 0, total: targets.length });
    setScanningName("");
    setScanSummary({
      ...EMPTY_SCAN_SUMMARY,
      startedAt: Date.now(),
    });

    if (!isDesktopRuntime()) {
      await runLegacyScan();
      return;
    }

    const startedAt = Date.now();
    let currentJobId: string | null = null;
    const unlisten = await listenScanEvents((event) => {
      if (currentJobId && event.jobId !== currentJobId) {
        return;
      }

      if (!currentJobId && event.type === "started") {
        currentJobId = event.jobId;
        setScanJobId(event.jobId);
      }

      if (!currentJobId) {
        return;
      }

      void applyScanEvent(event, async () => unlisten(), startedAt);
    });

    try {
      const jobId = await startScanJobDesktop("adaptive");
      currentJobId = jobId;
      setScanJobId(jobId);
    } catch (error) {
      await unlisten();
      setScanJobId(null);
      setNotice(
        `${getErrorMessage(error, "Gagal memulai background scan.")} Fallback ke scan kompatibilitas.`,
      );
      await runLegacyScan();
    }
  }, [applyScanEvent, runLegacyScan, targets.length]);

  const cancelCurrentScan = useCallback(async () => {
    if (!scanJobId) {
      return;
    }

    try {
      await cancelScanJobDesktop(scanJobId);
      setNotice("Membatalkan scan aktif...");
    } catch (error) {
      setNotice(getErrorMessage(error, "Gagal membatalkan scan aktif."));
    }
  }, [scanJobId]);

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
      let freedAccumulator = 0;

      for (let index = 0; index < ids.length; index++) {
        const id = ids[index];
        if (!id) {
          continue;
        }

        const target = results.find((item) => item.id === id);
        setCleanCurrent(index);
        setCleanName(target?.name ?? id);

        const result = await cleanTargetDesktop(id);
        freedAccumulator += result.freedBytes;
        setCleanCurrent(index + 1);
        setCleanFreed(freedAccumulator);
        setCleanResults((previous) => [...previous, result]);
      }

      setCleanDone(true);
    } catch (error) {
      setNotice(getErrorMessage(error, "Pembersihan gagal dijalankan."));
      setCleanDone(true);
    }
  }, [results, selected]);

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
      : null;
  const totalBloat = useMemo(
    () => results.reduce((sum, row) => sum + row.size, 0),
    [results],
  );
  const totalFiles = useMemo(
    () => results.reduce((sum, row) => sum + row.files, 0),
    [results],
  );
  const safeItems = useMemo(
    () => results.filter((row) => row.recommendation === "clean_now"),
    [results],
  );
  const reviewItems = useMemo(
    () => results.filter((row) => row.recommendation === "review_first"),
    [results],
  );
  const manualItems = useMemo(
    () => results.filter((row) => row.recommendation === "manual_only"),
    [results],
  );
  const unavailableItems = useMemo(
    () => results.filter((row) => row.recommendation === "unavailable"),
    [results],
  );
  const safeToFree = useMemo(
    () => safeItems.reduce((sum, row) => sum + row.size, 0),
    [safeItems],
  );
  const reviewToFree = useMemo(
    () => reviewItems.reduce((sum, row) => sum + row.size, 0),
    [reviewItems],
  );
  const advisoryBytes = useMemo(
    () => advisories.reduce((sum, item) => sum + item.size, 0),
    [advisories],
  );
  const driveNodes = useMemo(
    () => storageNodes.filter((item) => item.nodeType !== "file"),
    [storageNodes],
  );
  const largestFiles = useMemo(
    () => largestItems.filter((item) => item.nodeType === "file").slice(0, 24),
    [largestItems],
  );
  const largestFolders = useMemo(
    () =>
      largestItems.filter((item) => item.nodeType === "directory").slice(0, 18),
    [largestItems],
  );
  const minBytes = minSizeFilter === 0 ? 0 : minSizeFilter * 1024 * 1024;
  const topSafeCandidates = useMemo(
    () =>
      safeItems
        .slice()
        .sort((left, right) => right.size - left.size)
        .slice(0, 5),
    [safeItems],
  );
  const topReviewCandidates = useMemo(
    () =>
      reviewItems
        .slice()
        .sort((left, right) => right.size - left.size)
        .slice(0, 4),
    [reviewItems],
  );
  const topManualCandidates = useMemo(
    () =>
      manualItems
        .slice()
        .sort((left, right) => right.size - left.size)
        .slice(0, 3),
    [manualItems],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const selectedNode = useMemo(
    () => storageNodes.find((item) => item.id === selectedNodeId) ?? null,
    [selectedNodeId, storageNodes],
  );
  const treemapNodes = useMemo(() => {
    const currentParentId = selectedNode?.id ?? "c:\\";
    const directChildren = driveNodes
      .filter((item) => item.parentId === currentParentId)
      .sort((left, right) => right.size - left.size);
    if (directChildren.length > 0) {
      return directChildren.slice(0, 12);
    }
    return largestFolders.slice(0, 12).map((item) => ({
      id: item.id,
      parentId: undefined,
      path: item.path,
      name: item.name,
      nodeType: "directory" as const,
      size: item.size,
      fileCount: 0,
      childCount: 0,
      depth: 1,
      category: item.category,
      recommendation: item.recommendation,
      riskLevel: item.riskLevel,
      linkedTargetId: item.linkedTargetId,
      isKnownTarget: item.linkedTargetId !== undefined,
    }));
  }, [driveNodes, largestFolders, selectedNode]);
  const treemapTotal = useMemo(
    () => treemapNodes.reduce((sum, item) => sum + item.size, 0),
    [treemapNodes],
  );
  const filtered = useMemo(
    () =>
      results
        .filter((row) => activeTab === "Semua" || row.type === activeTab)
        .filter(
          (row) => safeFilter === "all" || row.safeToDelete === safeFilter,
        )
        .filter((row) => row.size >= minBytes)
        .filter((row) => {
          if (normalizedQuery.length === 0) {
            return true;
          }
          return (
            row.name.toLowerCase().includes(normalizedQuery) ||
            row.path.toLowerCase().includes(normalizedQuery) ||
            row.type.toLowerCase().includes(normalizedQuery) ||
            row.reason.toLowerCase().includes(normalizedQuery)
          );
        })
        .sort((left, right) => {
          if (sortBy === "name") {
            return left.name.localeCompare(right.name);
          }
          if (sortBy === "recommendation") {
            return (
              RECOMMENDATION_ORDER[left.recommendation] -
                RECOMMENDATION_ORDER[right.recommendation] ||
              SAFE_ORDER[left.safeToDelete] - SAFE_ORDER[right.safeToDelete]
            );
          }
          return right.size - left.size;
        }),
    [activeTab, minBytes, normalizedQuery, results, safeFilter, sortBy],
  );

  const toggleSelect = useCallback(
    (id: string, recommendation: Recommendation) => {
      if (recommendation !== "clean_now") {
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
    },
    [],
  );

  const selectOneSafe = useCallback(
    (id: string) => {
      const target = results.find((item) => item.id === id);
      if (!target || target.recommendation !== "clean_now") {
        return;
      }
      setExpanded(id);
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

  const selectedItems = safeItems.filter((item) => selected.has(item.id));
  const selectedSize = selectedItems.reduce((sum, item) => sum + item.size, 0);

  const diag = (() => {
    if (!done) {
      return null;
    }
    if (totalBloat === 0) {
      return {
        level: "green",
        msg: "Drive C Anda bersih. Tidak ada junk signifikan terdeteksi.",
      };
    }

    const gb = totalBloat / 1024 ** 3;
    if (gb > 10 || safeToFree > 5 * 1024 ** 3) {
      return {
        level: "red",
        msg: `Kritis. ${formatBytes(totalBloat)} junk ditemukan dan ${formatBytes(safeToFree)} siap dibersihkan sekarang.`,
      };
    }
    if (gb > 2 || reviewItems.length > 0) {
      return {
        level: "yellow",
        msg: `Perhatian. ${formatBytes(safeToFree)} siap dibersihkan, sisanya perlu review manual.`,
      };
    }
    return {
      level: "green",
      msg: `Aman. Mayoritas temuan saat ini berisiko rendah.`,
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
                Scan, review, lalu bersihkan junk file dengan preflight check
              </p>
            </div>
          </div>
          <button
            className="btn-scan"
            onClick={scanning ? () => void cancelCurrentScan() : startScan}
            disabled={showProgress}
          >
            {scanning
              ? "⏹️ Batalkan Scan"
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
              <span className="progress-title">
                <strong>{SCAN_PHASE_LABEL[scanPhase]}</strong>
                <span className="progress-divider">·</span>🔎 Menganalisis:{" "}
                <strong>{scanningName}</strong>
              </span>
              <div className="progress-actions">
                <span className="prog-pct">
                  {pct === null
                    ? `${formatNumber(progress.current)} item`
                    : `${pct}%`}
                </span>
                {scanJobId && (
                  <button
                    className="btn-cancel-scan"
                    onClick={() => void cancelCurrentScan()}
                  >
                    Batalkan
                  </button>
                )}
              </div>
            </div>
            <div className="prog-track">
              <div
                className={`prog-fill ${pct === null ? "prog-fill-indeterminate" : ""}`}
                style={{ width: pct === null ? "38%" : `${pct}%` }}
              />
            </div>
            <p className="prog-sub">
              {progress.total > 0
                ? `${progress.current} / ${progress.total} item selesai diproses`
                : `${formatNumber(progress.current)} folder/cluster sudah dianalisis`}
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
              <div className="scan-chip">
                <span>Advisory</span>
                <strong>{formatNumber(scanSummary.advisories)}</strong>
              </div>
            </div>
            {scanSummary.finishedAt && (
              <p className="scan-summary-time">
                Scan selesai: {formatDateTime(scanSummary.finishedAt)}
              </p>
            )}
          </div>
        )}

        {(results.length > 0 || advisories.length > 0) && (
          <div className="cards">
            <div className="card card-red">
              <div className="card-lbl">Total Sampah</div>
              <div className="card-val">{formatBytes(totalBloat)}</div>
              <div className="card-sub">{formatNumber(totalFiles)} file</div>
            </div>
            <div className="card card-green">
              <div className="card-lbl">Siap Dibersihkan</div>
              <div className="card-val">{formatBytes(safeToFree)}</div>
              <div className="card-sub">{safeItems.length} folder</div>
            </div>
            <div className="card card-yellow">
              <div className="card-lbl">Perlu Review</div>
              <div className="card-val">{formatNumber(reviewItems.length)}</div>
              <div className="card-sub">{formatBytes(reviewToFree)}</div>
            </div>
            <div className="card card-blue">
              <div className="card-lbl">Manual / Tertahan</div>
              <div className="card-val">
                {formatNumber(manualItems.length + unavailableItems.length)}
              </div>
              <div className="card-sub">
                {formatNumber(unavailableItems.length)} akses tertahan
              </div>
            </div>
            <div className="card card-purple">
              <div className="card-lbl">Disk Hog Advisory</div>
              <div className="card-val">{formatBytes(advisoryBytes)}</div>
              <div className="card-sub">
                {formatNumber(advisories.length)} temuan
              </div>
            </div>
          </div>
        )}

        {driveSummary && (
          <section className="analyzer-panel">
            <div className="priority-head">
              <h3>🗺️ Analyzer Drive C</h3>
              <span>
                {driveSummary.engineUsed} · {driveSummary.cacheState}
              </span>
            </div>
            <div className="scan-summary-grid analyzer-summary-grid">
              <div className="scan-chip">
                <span>Total Terindeks</span>
                <strong>{formatBytes(driveSummary.totalBytes)}</strong>
              </div>
              <div className="scan-chip">
                <span>Cleanable</span>
                <strong>{formatBytes(driveSummary.cleanableBytes)}</strong>
              </div>
              <div className="scan-chip">
                <span>Personal Data</span>
                <strong>{formatBytes(driveSummary.personalDataBytes)}</strong>
              </div>
              <div className="scan-chip">
                <span>Virtual Disk</span>
                <strong>{formatBytes(driveSummary.virtualDiskBytes)}</strong>
              </div>
              <div className="scan-chip">
                <span>Large Files</span>
                <strong>{formatBytes(driveSummary.largeFileBytes)}</strong>
              </div>
              <div className="scan-chip">
                <span>Node Tertangkap</span>
                <strong>{formatNumber(driveSummary.nodeCount)}</strong>
              </div>
              <div className="scan-chip">
                <span>Admin Accel</span>
                <strong>
                  {driveSummary.adminAcceleration ? "Aktif" : "Fallback"}
                </strong>
              </div>
            </div>
            {driveSummary.lastIndexedAt && (
              <p className="scan-summary-time">
                Index terakhir:{" "}
                {formatDateTime(driveSummary.lastIndexedAt * 1000)}
              </p>
            )}

            <div className="analyzer-tabs">
              {(
                [
                  ["treemap", "Treemap"],
                  ["files", "Largest Files"],
                  ["folders", "Largest Folders"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={`sort-btn ${analyzerTab === value ? "sort-active" : ""}`}
                  onClick={() => setAnalyzerTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {analyzerTab === "treemap" && (
              <div className="treemap-layout">
                <div className="treemap-board">
                  <div className="treemap-head">
                    <div>
                      <strong>
                        {selectedNode
                          ? selectedNode.name
                          : driveSummary.rootPath}
                      </strong>
                      <p>
                        {selectedNode
                          ? selectedNode.path
                          : "Klik tile untuk drill-down ke folder besar."}
                      </p>
                    </div>
                    {selectedNode && (
                      <button
                        className="sort-btn"
                        onClick={() => setSelectedNodeId(null)}
                      >
                        Kembali ke Root
                      </button>
                    )}
                  </div>
                  <div className="treemap-grid">
                    {treemapNodes.map((item) => (
                      <button
                        key={item.id}
                        className={`treemap-tile treemap-${item.riskLevel}`}
                        style={{
                          flexBasis: tileBasis(item.size, treemapTotal),
                        }}
                        onClick={() => setSelectedNodeId(item.id)}
                      >
                        <span className="treemap-name">{item.name}</span>
                        <span className="treemap-size">
                          {formatBytes(item.size)}
                        </span>
                        <span className="treemap-meta">
                          {item.category} ·{" "}
                          {RECOMMENDATION_MAP[item.recommendation].label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="treemap-side">
                  <div className="detail-block">
                    <div className="detail-lbl">Node Terpilih</div>
                    {selectedNode ? (
                      <>
                        <code className="detail-path">{selectedNode.path}</code>
                        <p className="detail-txt">
                          {selectedNode.category} ·{" "}
                          {formatBytes(selectedNode.size)} ·{" "}
                          {formatNumber(selectedNode.fileCount)} file
                        </p>
                        <div className="detail-actions">
                          <button
                            className="btn-open-folder"
                            onClick={() =>
                              void openScannedPath(selectedNode.path)
                            }
                          >
                            📂 Buka Lokasi
                          </button>
                          {selectedNode.linkedTargetId && (
                            <button
                              className="btn-quick-clean"
                              onClick={() => {
                                if (selectedNode.linkedTargetId) {
                                  selectOneSafe(selectedNode.linkedTargetId);
                                }
                              }}
                            >
                              🧹 Masuk ke Cleaner
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="detail-txt">
                        Pilih salah satu tile untuk melihat detail folder besar
                        dan memasukkannya ke cleaner bila terhubung ke target
                        aman.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {analyzerTab !== "treemap" && (
              <div className="largest-table">
                <div className="largest-table-head">
                  <span>Nama</span>
                  <span>Kategori</span>
                  <span>Ukuran</span>
                  <span>Aksi</span>
                </div>
                {(analyzerTab === "files" ? largestFiles : largestFolders).map(
                  (item) => (
                    <div key={item.id} className="largest-row">
                      <div className="largest-meta">
                        <strong>{item.name}</strong>
                        <code>{item.path}</code>
                      </div>
                      <span>{item.category}</span>
                      <span className="priority-size">
                        {formatBytes(item.size)}
                      </span>
                      <div className="detail-actions">
                        <button
                          className="sort-btn"
                          onClick={() => void openScannedPath(item.path)}
                        >
                          Buka
                        </button>
                        {item.linkedTargetId && (
                          <button
                            className="sort-btn"
                            onClick={() => {
                              if (item.linkedTargetId) {
                                selectOneSafe(item.linkedTargetId);
                              }
                            }}
                          >
                            Cleaner
                          </button>
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>
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
                    <div className="priority-meta">
                      <span className="priority-name">
                        {item.icon} {item.name}
                      </span>
                      <span className="priority-reason">{item.reason}</span>
                    </div>
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

        {done && topReviewCandidates.length > 0 && (
          <section className="priority-panel">
            <div className="priority-head">
              <h3>🔎 Butuh Review Manual</h3>
              <span>{reviewItems.length} target perlu dicek</span>
            </div>
            <div className="priority-list">
              {topReviewCandidates.map((item, index) => (
                <div key={item.id} className="priority-item">
                  <div className="priority-left">
                    <span className="priority-rank">#{index + 1}</span>
                    <div className="priority-meta">
                      <span className="priority-name">
                        {item.icon} {item.name}
                      </span>
                      <span className="priority-reason">{item.reason}</span>
                    </div>
                  </div>
                  <div className="priority-right">
                    <span className="priority-size">
                      {formatBytes(item.size)}
                    </span>
                    <button
                      className="sort-btn"
                      onClick={() => {
                        setExpanded(item.id);
                        void openFolder(item.id);
                      }}
                    >
                      Buka Folder
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {done && topManualCandidates.length > 0 && (
          <section className="priority-panel">
            <div className="priority-head">
              <h3>✋ Manual Action Only</h3>
              <span>{manualItems.length} target berisiko tinggi</span>
            </div>
            <div className="priority-list">
              {topManualCandidates.map((item, index) => (
                <div key={item.id} className="priority-item">
                  <div className="priority-left">
                    <span className="priority-rank">#{index + 1}</span>
                    <div className="priority-meta">
                      <span className="priority-name">
                        {item.icon} {item.name}
                      </span>
                      <span className="priority-reason">{item.reason}</span>
                    </div>
                  </div>
                  <div className="priority-right">
                    <span className="priority-size">
                      {formatBytes(item.size)}
                    </span>
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

        {done && advisories.length > 0 && (
          <section className="priority-panel">
            <div className="priority-head">
              <h3>🧠 Penyebab Disk Penuh Lainnya</h3>
              <span>{advisories.length} advisory non-auto-clean</span>
            </div>
            <div className="priority-list">
              {advisories
                .slice()
                .sort((left, right) => right.size - left.size)
                .map((item) => (
                  <div key={item.id} className="priority-item advisory-item">
                    <div className="priority-left">
                      <span
                        className={`risk-pill ${RISK_MAP[item.severity].cls}`}
                      >
                        {RISK_MAP[item.severity].label}
                      </span>
                      <div className="priority-meta">
                        <span className="priority-name">
                          {item.name} · {item.category}
                        </span>
                        <span className="priority-reason">{item.reason}</span>
                        <span className="priority-reason advisory-action">
                          Saran: {item.suggestedAction}
                        </span>
                        {item.path && (
                          <code className="advisory-path">{item.path}</code>
                        )}
                      </div>
                    </div>
                    <div className="priority-right">
                      <span className="priority-size">
                        {formatBytes(item.size)}
                      </span>
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
                {(["size", "name", "recommendation"] as const).map((value) => (
                  <button
                    key={value}
                    className={`sort-btn ${sortBy === value ? "sort-active" : ""}`}
                    onClick={() => setSortBy(value)}
                  >
                    {value === "size"
                      ? "Ukuran"
                      : value === "name"
                        ? "Nama"
                        : "Rekomendasi"}
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
                  <span className="hint-safe">Siap Dibersihkan</span> untuk
                  masuk batch clean. Item lain tetap ditahan sampai Anda review
                  manual.
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
                  onCheck={() => toggleSelect(item.id, item.recommendation)}
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

        {done && results.length === 0 && advisories.length === 0 && (
          <div className="empty">
            <div className="empty-icon">✨</div>
            <h2>Tidak ada folder besar terdeteksi</h2>
            <p>
              Target berhasil dipindai, tetapi tidak ada folder cache signifikan
              yang perlu dibersihkan saat ini.
            </p>
          </div>
        )}

        {done && results.length === 0 && advisories.length > 0 && (
          <div className="empty">
            <div className="empty-icon">🧠</div>
            <h2>Cache aman relatif sedikit, tapi ada disk hog lain</h2>
            <p>
              Tidak ada target auto-clean besar yang terdeteksi, namun advisory
              di atas menunjukkan file atau area sistem lain yang memakan ruang.
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
