import React, { useState, useEffect, useCallback, useRef, memo } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// ── UTILS ─────────────────────────────────────────────────────────────────────
function formatBytes(bytes: number, decimals = 1) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function formatNumber(n: number) {
  return n.toLocaleString("id-ID");
}

type SafeLevel = "safe" | "conditional" | "unsafe";

const SAFE_MAP: Record<SafeLevel, { label: string; cls: string }> = {
  safe:        { label: "✅ Aman Dihapus",  cls: "badge-safe" },
  conditional: { label: "⚠️ Periksa Dulu",  cls: "badge-warn" },
  unsafe:      { label: "🚫 Jangan Hapus",  cls: "badge-danger" },
};

const CATEGORIES = [
  "Semua", "System Cache", "User Files", "Dev Cache",
  "Browser Cache", "Virtual Machine", "Game Cache", "System Trash"
];

// ── DISK BAR ──────────────────────────────────────────────────────────────────
const DiskUsageBar = memo(function DiskUsageBar(
  { total, free, bloat }: { total: number; free: number; bloat: number }
) {
  if (!total) return null;
  const used     = total - free;
  const usedPct  = (used  / total) * 100;
  const bloatPct = Math.min((bloat / total) * 100, usedPct);
  const freePct  = (free  / total) * 100;

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
        <div className="disk-bar-used"  style={{ width: `${usedPct - bloatPct}%` }} />
        <div className="disk-bar-bloat" style={{ width: `${bloatPct}%` }}
          title={`${formatBytes(bloat)} terdeteksi sebagai sampah`} />
        <div className="disk-bar-free"  style={{ width: `${freePct}%` }} />
      </div>
      <div className="disk-bar-legend">
        <span><i className="dot dot-used" />Terpakai ({usedPct.toFixed(1)}%)</span>
        <span><i className="dot dot-bloat" />Sampah ({bloatPct.toFixed(1)}%)</span>
        <span><i className="dot dot-free" />Kosong ({freePct.toFixed(1)}%)</span>
      </div>
    </div>
  );
});

// ── SEVERITY BAR ──────────────────────────────────────────────────────────────
const SeverityBar = memo(function SeverityBar({ size }: { size: number }) {
  const MAX   = 5 * 1024 * 1024 * 1024;
  const pct   = Math.min((size / MAX) * 100, 100);
  const color = pct > 60 ? "#ef4444" : pct > 20 ? "#f59e0b" : "#22c55e";
  return (
    <div className="sev-track">
      <div className="sev-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
});

// ── COPY BTN ──────────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="copy-btn" onClick={copy} title="Salin perintah">
      {copied ? "✅ Disalin!" : "📋 Salin"}
    </button>
  );
}

// ── CLEAN PROGRESS OVERLAY ────────────────────────────────────────────────────
interface CleanResult {
  id: string;
  name: string;
  success: boolean;
  freedBytes: number;
  deletedFiles: number;
  errors: string[];
}

interface CleanProgressProps {
  total:       number;
  current:     number;
  currentName: string;
  done:        boolean;
  results:     CleanResult[];
  totalFreed:  number;
  onClose:     () => void;
}

function CleanProgress({
  total, current, currentName, done, results, totalFreed, onClose
}: CleanProgressProps) {
  const pct = total === 0 ? 0 : Math.round((current / total) * 100);

  return (
    <div className="modal-overlay" onClick={done ? onClose : undefined}>
      <div className="modal-box modal-box-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-icon">{done ? "✅" : "🧹"}</div>
        <h2 className="modal-title">
          {done ? "Pembersihan Selesai!" : "Sedang Membersihkan…"}
        </h2>

        {!done && (
          <p className="modal-subtitle">
            Mengerjakan <strong>{currentName}</strong> — {current} / {total} folder
          </p>
        )}
        {done && (
          <p className="modal-subtitle">
            Berhasil membebaskan{" "}
            <strong className="modal-size">{formatBytes(totalFreed)}</strong>{" "}
            dari <strong>{results.reduce((s, r) => s + r.deletedFiles, 0).toLocaleString("id-ID")} file</strong>.
          </p>
        )}

        {/* Progress bar */}
        <div className="clean-prog-wrap">
          <div className="clean-prog-track">
            <div
              className={`clean-prog-fill ${done ? "clean-prog-done" : ""}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="clean-prog-pct">{pct}%</span>
        </div>

        {/* Live result list */}
        <div className="modal-list clean-result-list">
          {results.length === 0 && !done && (
            <div className="clean-waiting">⏳ Mempersiapkan…</div>
          )}
          {results.map(r => (
            <div key={r.id} className={`modal-item ${r.success ? "modal-item-ok" : "modal-item-fail"}`}>
              <span className="modal-item-icon">{r.success ? "✅" : "❌"}</span>
              <div className="modal-item-info">
                <span className="modal-item-name">{r.name}</span>
                <span className="modal-item-size">
                  {r.success
                    ? `-${formatBytes(r.freedBytes)} · ${formatNumber(r.deletedFiles)} file dihapus`
                    : r.errors[0] ?? "gagal"}
                </span>
              </div>
            </div>
          ))}
        </div>

        {done && results.some(r => r.errors.length > 0) && (
          <div className="modal-warn">
            ℹ️ Beberapa file tidak bisa dihapus karena sedang dipakai sistem. Ini normal.
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

// ── CONFIRM MODAL ─────────────────────────────────────────────────────────────
interface ConfirmModalProps {
  items:     any[];
  totalSize: number;
  onConfirm: () => void;
  onCancel:  () => void;
}

const ConfirmModal = memo(function ConfirmModal(
  { items, totalSize, onConfirm, onCancel }: ConfirmModalProps
) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-icon">🧹</div>
        <h2 className="modal-title">Konfirmasi Pembersihan</h2>
        <p className="modal-subtitle">
          Anda akan membersihkan <strong>{items.length} folder</strong> dan
          membebaskan sekitar{" "}
          <strong className="modal-size">{formatBytes(totalSize)}</strong>.
        </p>

        <div className="modal-list">
          {items.map(item => (
            <div key={item.id} className="modal-item">
              <span className="modal-item-icon">{item.icon}</span>
              <div className="modal-item-info">
                <span className="modal-item-name">{item.name}</span>
                <span className="modal-item-size">{formatBytes(item.size)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-warn">
          ⚠️ File yang sudah dibersihkan <strong>tidak bisa dikembalikan</strong>.
          Semua item berlabel "Aman Dihapus" telah diverifikasi aman.
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>Batalkan</button>
          <button className="btn-confirm" onClick={onConfirm}>
            🗑️ Ya, Bersihkan Sekarang
          </button>
        </div>
      </div>
    </div>
  );
});

// ── FLOATING CLEAN BAR ────────────────────────────────────────────────────────
interface CleanBarProps {
  selected:      any[];
  allSafeCount:  number;
  onSelectAll:   () => void;
  onDeselectAll: () => void;
  onClean:       () => void;
}

const CleanBar = memo(function CleanBar(
  { selected, allSafeCount, onSelectAll, onDeselectAll, onClean }: CleanBarProps
) {
  if (allSafeCount === 0) return null;
  const totalSize = selected.reduce((s, r) => s + r.size, 0);

  return (
    <div className={`clean-bar ${selected.length > 0 ? "clean-bar-active" : ""}`}>
      <div className="clean-bar-inner">
        <div className="clean-bar-left">
          <span className="clean-bar-count">
            {selected.length > 0
              ? `${selected.length} folder dipilih · ${formatBytes(totalSize)}`
              : `${allSafeCount} folder aman tersedia untuk dibersihkan`}
          </span>
          <div className="clean-bar-btns">
            <button className="cb-btn" onClick={onSelectAll}>✅ Pilih Semua Aman</button>
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

// ── RESULT ROW (memoized agar tidak re-render saat parent update) ──────────────
interface RowProps {
  item:       any;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle:   () => void;
  onCheck:    () => void;
}

const ResultRow = memo(function ResultRow(
  { item, isExpanded, isSelected, onToggle, onCheck }: RowProps
) {
  const canSelect = item.safeToDelete === "safe";
  const isBig     = item.size > 500 * 1024 * 1024;
  const isMed     = item.size > 100 * 1024 * 1024;
  const rowCls    = `row ${isBig ? "row-danger" : isMed ? "row-warn" : "row-ok"} ${isSelected ? "row-selected" : ""}`;

  return (
    <div className={rowCls}>
      <div className="row-hd">
        {/* Checkbox */}
        <div
          className={`row-check ${canSelect ? "row-check-enabled" : "row-check-disabled"}`}
          onClick={canSelect ? onCheck : undefined}
          title={canSelect ? "Pilih untuk dibersihkan" : "Hanya berlabel 'Aman Dihapus' yang bisa dipilih"}
        >
          <div className={`checkbox ${isSelected ? "checkbox-checked" : ""}`}>
            {isSelected && <span>✓</span>}
          </div>
        </div>

        {/* Main clickable area */}
        <div className="row-left" onClick={onToggle}>
          <span className="row-icon">{item.icon}</span>
          <div className="row-meta">
            <span className="row-name">{item.name}</span>
            <span className="row-type">{item.type}</span>
          </div>
        </div>

        <div className="row-right" onClick={onToggle}>
          <span className={`badge ${SAFE_MAP[item.safeToDelete as SafeLevel].cls}`}>
            {SAFE_MAP[item.safeToDelete as SafeLevel].label}
          </span>
          <div className="row-size-col">
            <span className="row-size">{formatBytes(item.size)}</span>
            <SeverityBar size={item.size} />
            {item.files > 0 && (
              <span className="row-files">{formatNumber(item.files)} file</span>
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
            </div>
            <div className="detail-block">
              <div className="detail-lbl">📖 Penjelasan</div>
              <p className="detail-txt">{item.description}</p>
            </div>
            <div className="detail-block">
              <div className="detail-lbl">
                {item.safeToDelete === "safe"   ? "✅ Status: Aman Dihapus"
                : item.safeToDelete === "conditional" ? "⚠️ Status: Perlu Hati-hati"
                : "🚫 Status: Jangan Hapus Sembarangan"}
              </div>
              <p className="detail-txt">{item.safeNote}</p>
            </div>
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
                    {isSelected ? "✓ Dipilih untuk Dibersihkan" : "+ Pilih untuk Dibersihkan"}
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

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [targets, setTargets]     = useState<any[]>([]);
  const [results, setResults]     = useState<any[]>([]);
  const [diskInfo, setDiskInfo]   = useState<{ total: number; free: number; used: number } | null>(null);
  const [scanning, setScanning]   = useState(false);
  const [progress, setProgress]   = useState({ current: 0, total: 1 });
  const [scanningName, setScanningName] = useState("");
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [done, setDone]           = useState(false);
  const [activeTab, setActiveTab] = useState("Semua");
  const [sortBy, setSortBy]       = useState<"size" | "name" | "safe">("size");

  // Clean state
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [cleanCurrent, setCleanCurrent]  = useState(0);
  const [cleanTotal, setCleanTotal]      = useState(0);
  const [cleanName, setCleanName]        = useState("");
  const [cleanDone, setCleanDone]        = useState(false);
  const [cleanResults, setCleanResults]  = useState<CleanResult[]>([]);
  const [cleanFreed, setCleanFreed]      = useState(0);

  const refreshDisk = useCallback(() => {
    fetch("/api/diskinfo").then(r => r.json()).then(setDiskInfo).catch(console.error);
  }, []);

  useEffect(() => {
    fetch("/api/targets").then(r => r.json()).then(setTargets).catch(console.error);
    refreshDisk();
  }, []);

  // ── SCAN ────────────────────────────────────────────────────────────────────
  const startScan = useCallback(async () => {
    setScanning(true);
    setDone(false);
    setResults([]);
    setExpanded(null);
    setSelected(new Set());
    setProgress({ current: 0, total: targets.length });

    const acc: any[] = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      setScanningName(t.name);
      try {
        const res = await fetch(`/api/scan/${t.id}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.size > 0) acc.push(data);
        }
      } catch (e) { console.error(e); }
      // sort tanpa create array baru setiap kali — pakai spread hanya satu kali
      setResults(acc.slice().sort((a, b) => b.size - a.size));
      setProgress({ current: i + 1, total: targets.length });
    }

    setScanning(false);
    setScanningName("");
    setDone(true);
    refreshDisk();
  }, [targets, refreshDisk]);

  // ── CLEAN via SSE streaming ──────────────────────────────────────────────────
  const doClean = useCallback(async () => {
    setShowConfirm(false);
    const ids = [...selected];
    setSelected(new Set());
    setShowProgress(true);
    setCleanDone(false);
    setCleanResults([]);
    setCleanFreed(0);
    setCleanCurrent(0);
    setCleanTotal(ids.length);
    setCleanName("");

    let freedAcc = 0;

    try {
      const res = await fetch("/api/clean/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });

      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf      = "";

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += dec.decode(value, { stream: true });

        // Parse SSE events
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.type === "progress") {
              setCleanCurrent(msg.index);
              setCleanName(msg.id ?? "");
            } else if (msg.type === "result") {
              const r = msg.result as CleanResult;
              freedAcc += r.freedBytes;
              setCleanFreed(freedAcc);
              setCleanResults(prev => [...prev, r]);
              setCleanCurrent(msg.index + 1);
            } else if (msg.type === "done") {
              setCleanDone(true);
            }
          } catch { /* malformed SSE */ }
        }
      }
    } catch (e) {
      console.error(e);
      setCleanDone(true);
    }
  }, [selected]);

  const afterCleanClose = useCallback(() => {
    setShowProgress(false);
    refreshDisk();
    if (done) startScan();
  }, [done, startScan, refreshDisk]);

  // ── DERIVED ─────────────────────────────────────────────────────────────────
  const pct        = Math.round((progress.current / progress.total) * 100) || 0;
  const totalBloat = results.reduce((s, r) => s + r.size, 0);
  const totalFiles = results.reduce((s, r) => s + (r.files ?? 0), 0);
  const safeItems  = results.filter(r => r.safeToDelete === "safe");
  const safeToFree = safeItems.reduce((s, r) => s + r.size, 0);

  const filtered = results
    .filter(r => activeTab === "Semua" || r.type === activeTab)
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "safe") {
        const o: Record<SafeLevel, number> = { safe: 0, conditional: 1, unsafe: 2 };
        return o[a.safeToDelete as SafeLevel] - o[b.safeToDelete as SafeLevel];
      }
      return b.size - a.size;
    });

  const toggleSelect = useCallback((id: string, safeToDelete: string) => {
    if (safeToDelete !== "safe") return;
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll   = useCallback(() => setSelected(new Set(safeItems.map(r => r.id))), [safeItems]);
  const deselectAll = useCallback(() => setSelected(new Set()), []);

  const selectedItems = results.filter(r => selected.has(r.id));
  const selectedSize  = selectedItems.reduce((s, r) => s + r.size, 0);

  const diag = (() => {
    if (!done) return null;
    if (totalBloat === 0) return { level: "green", msg: "Drive C Anda bersih! Tidak ada sampah terdeteksi." };
    const gb = totalBloat / (1024 ** 3);
    if (gb > 10) return { level: "red",    msg: `Kritis! ${formatBytes(totalBloat)} sampah ditemukan. Segera bersihkan!` };
    if (gb > 2)  return { level: "yellow", msg: `Perhatian. ${formatBytes(totalBloat)} sampah ditemukan. Perlu dibersihkan.` };
    return         { level: "green",  msg: `Aman. Hanya ${formatBytes(totalBloat)} sampah terdeteksi.` };
  })();

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* MODAL — KONFIRMASI */}
      {showConfirm && (
        <ConfirmModal
          items={selectedItems}
          totalSize={selectedSize}
          onConfirm={doClean}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {/* MODAL — PROGRESS CLEANING */}
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

      {/* HEADER */}
      <header className="hdr">
        <div className="hdr-inner">
          <div className="hdr-brand">
            <span className="hdr-logo">🩺</span>
            <div>
              <h1>Dokter Storage C</h1>
              <p>Deteksi mendalam penyebab Drive C penuh · Bersihkan langsung dari browser</p>
            </div>
          </div>
          <button
            className="btn-scan"
            onClick={startScan}
            disabled={scanning || showProgress}
          >
            {scanning ? `⏳ Memindai… ${pct}%` : done ? "🔁 Scan Ulang" : "🔍 Mulai Pemindaian"}
          </button>
        </div>
      </header>

      <main className="main">

        {/* DISK BAR */}
        {diskInfo && diskInfo.total > 0 && (
          <DiskUsageBar total={diskInfo.total} free={diskInfo.free} bloat={totalBloat} />
        )}

        {/* SCAN PROGRESS */}
        {scanning && (
          <div className="progress-card">
            <div className="progress-top">
              <span>🔎 Menganalisis: <strong>{scanningName}</strong></span>
              <span className="prog-pct">{pct}%</span>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="prog-sub">{progress.current} / {progress.total} folder diperiksa</p>
          </div>
        )}

        {/* VERDICT */}
        {diag && (
          <div className={`verdict verdict-${diag.level}`}>
            <span className="verdict-icon">
              {diag.level === "red" ? "🚨" : diag.level === "yellow" ? "⚠️" : "✅"}
            </span>
            <span>{diag.msg}</span>
          </div>
        )}

        {/* SUMMARY CARDS */}
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
              <div className="card-val">{results.filter(r => r.safeToDelete === "conditional").length}</div>
              <div className="card-sub">folder hati-hati</div>
            </div>
            <div className="card card-blue">
              <div className="card-lbl">Ditemukan</div>
              <div className="card-val">{results.length}</div>
              <div className="card-sub">dari {targets.length} dicek</div>
            </div>
          </div>
        )}

        {/* RESULTS */}
        {results.length > 0 && (
          <section className="results">
            {/* TOOLBAR */}
            <div className="toolbar">
              <div className="tabs">
                {CATEGORIES.map(cat => (
                  <button key={cat}
                    className={`tab ${activeTab === cat ? "tab-active" : ""}`}
                    onClick={() => setActiveTab(cat)}>
                    {cat}
                    {cat !== "Semua" && (
                      <span className="tab-count">
                        {results.filter(r => r.type === cat).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="sort-row">
                <span className="sort-lbl">Urutkan:</span>
                {(["size", "name", "safe"] as const).map(s => (
                  <button key={s}
                    className={`sort-btn ${sortBy === s ? "sort-active" : ""}`}
                    onClick={() => setSortBy(s)}>
                    {s === "size" ? "Ukuran" : s === "name" ? "Nama" : "Keamanan"}
                  </button>
                ))}
              </div>
            </div>

            {/* HEADING */}
            <div className="results-hd">
              <h2>
                📋 Hasil Pemindaian&nbsp;
                {scanning
                  ? <span className="tag-live">Live</span>
                  : <span className="tag-done">Selesai · {filtered.length} item</span>}
              </h2>
              {done && safeItems.length > 0 && (
                <p className="results-hint">
                  💡 Centang item berlabel{" "}
                  <span className="hint-safe">Aman Dihapus</span>{" "}
                  lalu klik tombol <strong>Bersihkan</strong> di bawah.
                </p>
              )}
            </div>

            {/* LIST */}
            <div className="list">
              {filtered.map(item => (
                <ResultRow
                  key={item.id}
                  item={item}
                  isExpanded={expanded === item.id}
                  isSelected={selected.has(item.id)}
                  onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
                  onCheck={() => toggleSelect(item.id, item.safeToDelete)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="no-results">
                  Tidak ada hasil untuk kategori <strong>{activeTab}</strong>
                </div>
              )}
            </div>
          </section>
        )}

        {/* EMPTY STATE */}
        {!scanning && !done && (
          <div className="empty">
            <div className="empty-icon">🩺</div>
            <h2>Siap Mendiagnosis Drive C</h2>
            <p>
              Klik <strong>"Mulai Pemindaian"</strong> di atas.<br />
              Hasil muncul <em>realtime</em> satu per satu.
            </p>
          </div>
        )}
      </main>

      {/* FLOATING CLEAN BAR */}
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
