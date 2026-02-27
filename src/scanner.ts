import { readdir, stat, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const USER_DIR = homedir();

export interface Target {
  id: string;
  name: string;
  path: string;
  type: string;
  icon: string;
  description: string;
  safeToDelete: "safe" | "conditional" | "unsafe";
  safeNote: string;
  cleanCommand?: string;
}

export const TARGETS: Target[] = [
  // ── SYSTEM CACHE ────────────────────────────────────────────────────────────
  {
    id: "windows_temp",
    name: "Windows Temp",
    path: "C:\\Windows\\Temp",
    type: "System Cache",
    icon: "🪟",
    description: "File sementara milik sistem Windows. Dibuat saat proses instalasi, update, atau error sistem. Salah satu tersangka klasik yang sering diabaikan.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Windows akan membuat ulang jika diperlukan. Skip file yang tidak bisa dihapus (sedang dipakai).",
    cleanCommand: "Disk Cleanup > 'Temporary files'"
  },
  {
    id: "user_temp",
    name: "User Temp (%TEMP%)",
    path: join(USER_DIR, "AppData", "Local", "Temp"),
    type: "System Cache",
    icon: "🧹",
    description: "File sementara milik akun Anda. Dibuat oleh browser, IDE, installer, dan hampir semua aplikasi. Sering diabaikan berbulan-bulan.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Tekan Win+R lalu ketik %TEMP% untuk membukanya langsung. Pilih semua (Ctrl+A) lalu Delete. Skip file yang tidak bisa dihapus.",
    cleanCommand: "Win+R > %TEMP% > Ctrl+A > Delete"
  },
  {
    id: "win_update",
    name: "Windows Update Cache",
    path: "C:\\Windows\\SoftwareDistribution\\Download",
    type: "System Cache",
    icon: "🔄",
    description: "File paket update Windows yang sudah terinstall namun tidak dibersihkan. Bisa mencapai belasan GB dan sering jadi biang utama!",
    safeToDelete: "safe",
    safeNote: "Aman dihapus setelah update selesai. Cara terbaik: jalankan Disk Cleanup sebagai Administrator, lalu pilih 'Windows Update Cleanup'.",
    cleanCommand: "Disk Cleanup (Admin) > 'Windows Update Cleanup'"
  },
  {
    id: "prefetch",
    name: "Prefetch",
    path: "C:\\Windows\\Prefetch",
    type: "System Cache",
    icon: "⚡",
    description: "Data cache Windows untuk mempercepat loading aplikasi yang sering dipakai. Umumnya kecil, tapi ada di setiap Windows.",
    safeToDelete: "conditional",
    safeNote: "Boleh dihapus. Aplikasi akan terasa sedikit lebih lambat dibuka pertama kali sampai cache terbentuk lagi secara otomatis.",
    cleanCommand: "Disk Cleanup > 'Temporary files'"
  },
  {
    id: "win_installer",
    name: "Windows Installer Cache",
    path: "C:\\Windows\\Installer",
    type: "System Cache",
    icon: "📦",
    description: "Berisi file installer (.msi, .msp) dari semua program yang pernah terinstall. Dibutuhkan untuk uninstall/repair. Bisa mencapai 5-20 GB!",
    safeToDelete: "unsafe",
    safeNote: "JANGAN HAPUS sembarangan! Jika dihapus, Anda tidak bisa uninstall atau repair program tertentu. Gunakan tool khusus seperti 'PatchCleaner' untuk membersihkan yang orphaned saja.",
    cleanCommand: "Gunakan PatchCleaner (tool gratis) untuk hapus orphaned installer"
  },
  {
    id: "win_error_reports",
    name: "Windows Error Reports",
    path: join(USER_DIR, "AppData", "Local", "Microsoft", "Windows", "WER"),
    type: "System Cache",
    icon: "💥",
    description: "Log laporan crash dan error semua aplikasi Windows. Tidak berguna bagi pengguna biasa dan terus menumpuk.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Ini hanya log untuk dikirim ke Microsoft. Tidak mempengaruhi fungsi apapun.",
    cleanCommand: "Disk Cleanup > 'Windows Error Reporting Files'"
  },
  {
    id: "iis_logs",
    name: "IIS Server Logs",
    path: "C:\\inetpub\\logs\\LogFiles",
    type: "System Cache",
    icon: "🌐",
    description: "Log akses web server IIS (Internet Information Services). Jika Anda tidak aktif pakai IIS, log ini bisa menumpuk hingga GB.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus jika Anda tidak butuh audit log akses web. Hapus file .log lama, sisakan yang baru jika needed.",
    cleanCommand: "Hapus file *.log di C:\\inetpub\\logs\\LogFiles secara manual"
  },

  // ── USER FILES ───────────────────────────────────────────────────────────────
  {
    id: "downloads",
    name: "Folder Downloads",
    path: join(USER_DIR, "Downloads"),
    type: "User Files",
    icon: "📥",
    description: "Folder Downloads Anda. Seringkali penuh dengan installer .exe, file .zip, video, PDF yang sudah tidak terpakai. Wajib diperiksa!",
    safeToDelete: "conditional",
    safeNote: "Periksa dulu satu per satu! Sortir berdasarkan ukuran terbesar. Hapus installer & file yang tidak dibutuhkan.",
    cleanCommand: "File Explorer > Downloads > Sortir by Size > Hapus manual"
  },
  {
    id: "recycle_bin",
    name: "Recycle Bin",
    path: "C:\\$Recycle.Bin",
    type: "System Trash",
    icon: "🗑️",
    description: "File yang sudah Anda hapus namun masih tersimpan di Recycle Bin. Tidak benar-benar gratis sampai Recycle Bin dikosongkan.",
    safeToDelete: "safe",
    safeNote: "100% Aman dikosongkan. Klik kanan ikon Recycle Bin di Desktop > Empty Recycle Bin.",
    cleanCommand: "Klik kanan Recycle Bin di Desktop > Empty Recycle Bin"
  },

  // ── DEV CACHE ────────────────────────────────────────────────────────────────
  {
    id: "npm_cache",
    name: "NPM Cache",
    path: join(USER_DIR, "AppData", "Local", "npm-cache"),
    type: "Dev Cache",
    icon: "📦",
    description: "Cache package NPM (Node.js). Menumpuk dari setiap kali 'npm install' dijalankan di manapun. Developer sering kaget betapa besarnya.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. NPM akan download ulang package saat install berikutnya. Project yang sudah ada tidak terpengaruh.",
    cleanCommand: "npm cache clean --force"
  },
  {
    id: "bun_cache",
    name: "Bun Cache",
    path: join(USER_DIR, ".bun", "install", "cache"),
    type: "Dev Cache",
    icon: "🍞",
    description: "Cache package Bun. Runtime JavaScript modern yang sangat cepat tapi juga menumpuk cache.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Bun akan download ulang saat diperlukan.",
    cleanCommand: "bun pm cache rm"
  },
  {
    id: "yarn_cache",
    name: "Yarn Cache",
    path: join(USER_DIR, "AppData", "Local", "Yarn", "Cache"),
    type: "Dev Cache",
    icon: "🧶",
    description: "Cache package Yarn. Sering terlupakan karena lokasinya tersembunyi di AppData.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Yarn akan download ulang saat diperlukan.",
    cleanCommand: "yarn cache clean"
  },
  {
    id: "pnpm_store",
    name: "PNPM Store",
    path: join(USER_DIR, "AppData", "Local", "pnpm", "store"),
    type: "Dev Cache",
    icon: "🗄️",
    description: "Store terpusat PNPM. Semua project PNPM berbagi store ini, sehingga bisa sangat besar namun juga efisien.",
    safeToDelete: "conditional",
    safeNote: "Hati-hati! Store ini dipakai bersama semua project PNPM aktif. Gunakan 'pnpm store prune' untuk hapus yang sudah tidak direferensikan saja.",
    cleanCommand: "pnpm store prune"
  },
  {
    id: "pip_cache",
    name: "Python PIP Cache",
    path: join(USER_DIR, "AppData", "Local", "pip", "Cache"),
    type: "Dev Cache",
    icon: "🐍",
    description: "Cache package Python (pip). Jika Anda sering install library Python / data science, ini bisa cukup besar.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. PIP akan download ulang package saat install berikutnya.",
    cleanCommand: "pip cache purge"
  },
  {
    id: "maven_cache",
    name: "Maven Repository (Java)",
    path: join(USER_DIR, ".m2", "repository"),
    type: "Dev Cache",
    icon: "☕",
    description: "Repository lokal Maven untuk project Java/Spring. Setiap dependency Java tersimpan di sini dan bisa mencapai GB.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Maven akan download ulang JAR yang dibutuhkan saat build berikutnya (memakan waktu lebih lama).",
    cleanCommand: "Hapus folder .m2\\repository secara manual"
  },
  {
    id: "gradle_cache",
    name: "Gradle Cache (Java/Android)",
    path: join(USER_DIR, ".gradle", "caches"),
    type: "Dev Cache",
    icon: "🤖",
    description: "Cache build tool Gradle untuk Java & Android Studio. Bisa mencapai 5-15 GB tanpa disadari, terutama developer Android.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Gradle akan rebuild cache saat build project berikutnya (build pertama akan lebih lama).",
    cleanCommand: "Hapus folder .gradle\\caches secara manual"
  },
  {
    id: "cargo_registry",
    name: "Cargo Registry (Rust)",
    path: join(USER_DIR, ".cargo", "registry"),
    type: "Dev Cache",
    icon: "🦀",
    description: "Cache package Rust (Cargo crates). Bisa sangat besar jika aktif mengembangkan aplikasi Rust.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Cargo akan download ulang saat build project Rust berikutnya.",
    cleanCommand: "cargo cache --autoclean"
  },
  {
    id: "jetbrains_cache",
    name: "JetBrains IDE Cache",
    path: join(USER_DIR, "AppData", "Local", "JetBrains"),
    type: "Dev Cache",
    icon: "🧠",
    description: "Cache semua produk JetBrains (IntelliJ, WebStorm, PyCharm, GoLand, dll). Index & cache IDE yang sangat besar.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. IDE akan membangun ulang index saat pertama dibuka (prosesnya memakan waktu beberapa menit).",
    cleanCommand: "File > Invalidate Caches > Invalidate and Restart (dari dalam IDE)"
  },
  {
    id: "vscode_cache",
    name: "VS Code Cache",
    path: join(USER_DIR, "AppData", "Roaming", "Code", "Cache"),
    type: "Dev Cache",
    icon: "💻",
    description: "Cache editor VS Code: ekstensi, indexing workspace, dan file yang pernah dibuka.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. VS Code akan membuat cache baru. Ekstensi dan pengaturan Anda tidak akan hilang.",
    cleanCommand: "Help > Toggle Developer Tools > Application > Clear Storage"
  },

  // ── BROWSER CACHE ────────────────────────────────────────────────────────────
  {
    id: "chrome_cache",
    name: "Google Chrome Cache",
    path: join(USER_DIR, "AppData", "Local", "Google", "Chrome", "User Data", "Default", "Cache"),
    type: "Browser Cache",
    icon: "🌐",
    description: "Cache browser Chrome: gambar, video, script, dan halaman web yang pernah dikunjungi. Terus bertambah setiap browsing.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Website akan terasa sedikit lebih lambat dibuka pertama kali, tapi tidak ada data penting yang hilang.",
    cleanCommand: "Chrome: Ctrl+Shift+Delete > Cached images and files > Clear data"
  },
  {
    id: "edge_cache",
    name: "Microsoft Edge Cache",
    path: join(USER_DIR, "AppData", "Local", "Microsoft", "Edge", "User Data", "Default", "Cache"),
    type: "Browser Cache",
    icon: "🌀",
    description: "Cache browser Microsoft Edge. Mirip Chrome karena berbasis Chromium.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Tidak ada data penting yang hilang.",
    cleanCommand: "Edge: Ctrl+Shift+Delete > Cached images and files > Clear now"
  },
  {
    id: "firefox_cache",
    name: "Firefox Cache",
    path: join(USER_DIR, "AppData", "Local", "Mozilla", "Firefox", "Profiles"),
    type: "Browser Cache",
    icon: "🦊",
    description: "Cache browser Firefox yang tersimpan di dalam folder profile.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus via menu Firefox. Jangan hapus folder manual karena bisa merusak profile.",
    cleanCommand: "Firefox: Ctrl+Shift+Delete > Cache > Clear Now"
  },

  // ── VIRTUAL MACHINE & GAME ───────────────────────────────────────────────────
  {
    id: "docker_wsl",
    name: "Docker WSL Data",
    path: join(USER_DIR, "AppData", "Local", "Docker", "wsl", "data"),
    type: "Virtual Machine",
    icon: "🐳",
    description: "File virtual disk Docker Desktop (WSL2). Sering menjadi penyebab UTAMA Drive C penuh — bisa 20-50 GB! File .vhdx ini tidak menyusut otomatis.",
    safeToDelete: "conditional",
    safeNote: "JANGAN hapus folder langsung! Hapus dulu image & container tak terpakai via 'docker system prune -a', lalu shrink disk via WSL.",
    cleanCommand: "docker system prune -a --volumes"
  },
  {
    id: "android_avd",
    name: "Android Emulator (AVD)",
    path: join(USER_DIR, ".android", "avd"),
    type: "Virtual Machine",
    icon: "📱",
    description: "File image virtual device Android. Setiap satu emulator bisa menghabiskan 4-10 GB. Jika punya banyak AVD, ini biang kerok utama!",
    safeToDelete: "conditional",
    safeNote: "Hapus AVD yang tidak digunakan via Android Studio: Device Manager > pilih AVD > klik Delete.",
    cleanCommand: "Android Studio > Device Manager > Hapus AVD yang tidak dipakai"
  },
  {
    id: "steam_shader",
    name: "Steam Shader Cache",
    path: join(USER_DIR, "AppData", "Local", "Steam", "htmlcache"),
    type: "Game Cache",
    icon: "🎮",
    description: "Cache shader dan HTML milik Steam client. Bisa membengkak dari setiap game yang dimainkan.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Steam akan rebuild cache saat dibuka kembali. Tidak mempengaruhi game save.",
    cleanCommand: "Steam: Settings > Downloads > Clear Download Cache"
  },
  {
    id: "epic_cache",
    name: "Epic Games Cache",
    path: join(USER_DIR, "AppData", "Local", "EpicGamesLauncher", "Saved", "webcache"),
    type: "Game Cache",
    icon: "🎯",
    description: "Cache launcher Epic Games Store. Menumpuk dari browsing store dan update launcher.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Epic Games Launcher akan rebuild cache saat dibuka ulang.",
    cleanCommand: "Hapus folder webcache secara manual lalu restart Epic Launcher"
  },
];

// ── DISK INFO ────────────────────────────────────────────────────────────────
export async function getDiskInfo(): Promise<{ total: number; free: number; used: number }> {
  try {
    const result = await Bun.$`wmic logicaldisk where "DeviceID='C:'" get Size,FreeSpace /format:csv`.text();
    const lines = result.trim().split("\n").filter(l => l.includes(",") && !l.toLowerCase().includes("freespace"));
    if (lines.length > 0) {
      const parts = lines[0]!.trim().split(",");
      if (parts.length >= 3) {
        const free = parseInt(parts[1]!.trim()) || 0;
        const total = parseInt(parts[2]!.trim()) || 0;
        return { total, free, used: total - free };
      }
    }
  } catch {
    // fallback jika wmic gagal
  }
  return { total: 0, free: 0, used: 0 };
}

// ── SIZE SCANNER (parallel, concurrency-limited) ──────────────────────────────
const CONCURRENCY = 32;

async function getDirSizeAndCount(dirPath: string): Promise<{ size: number; files: number }> {
  let size = 0;
  let files = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    // Pisahkan dir vs file lalu proses secara paralel dengan batas concurrency
    const dirs: string[] = [];
    const fileEntries: string[] = [];
    for (const e of entries) {
      if (e.isDirectory()) dirs.push(join(dirPath, e.name));
      else fileEntries.push(join(dirPath, e.name));
    }

    // Rekursi folder secara paralel (batasi CONCURRENCY)
    for (let i = 0; i < dirs.length; i += CONCURRENCY) {
      const batch = dirs.slice(i, i + CONCURRENCY);
      const subs = await Promise.all(batch.map(d => getDirSizeAndCount(d)));
      for (const sub of subs) { size += sub.size; files += sub.files; }
    }

    // stat file secara paralel
    for (let i = 0; i < fileEntries.length; i += CONCURRENCY) {
      const batch = fileEntries.slice(i, i + CONCURRENCY);
      const stats = await Promise.all(batch.map(f => stat(f).catch(() => null)));
      for (const s of stats) if (s) { size += s.size; files++; }
    }
  } catch {
    // Abaikan error permission
  }
  return { size, files };
}

export async function scanSingleTarget(id: string) {
  const target = TARGETS.find(t => t.id === id);
  if (!target) return null;

  const dirStat = await stat(target.path).catch(() => null);
  if (dirStat && dirStat.isDirectory()) {
    const { size, files } = await getDirSizeAndCount(target.path);
    return { ...target, size, files };
  }

  return { ...target, size: 0, files: 0 };
}

// ── CLEANER (paralel) ─────────────────────────────────────────────────────────
async function deleteDirContents(dirPath: string): Promise<{ deleted: number; freed: number; errors: string[] }> {
  let deleted = 0;
  let freed = 0;
  const errors: string[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    await Promise.all(entries.map(async entry => {
      const full = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          // Hitung dulu sebelum hapus
          const sub = await getDirSizeAndCount(full);
          await rm(full, { recursive: true, force: true });
          freed += sub.size;
          deleted += sub.files;
        } else {
          const s = await stat(full).catch(() => null);
          await unlink(full);
          if (s) freed += s.size;
          deleted++;
        }
      } catch (e: any) {
        errors.push(entry.name + ": " + (e?.message ?? "gagal"));
      }
    }));
  } catch (e: any) {
    errors.push(e?.message ?? "Tidak bisa buka folder");
  }

  return { deleted, freed, errors };
}

// Streaming cleanTarget — panggil onProgress setiap folder selesai
export async function cleanTargetStream(
  id: string,
  onProgress: (result: CleanResult) => void
): Promise<void> {
  const target = TARGETS.find(t => t.id === id);
  if (!target) {
    onProgress({ id, name: id, success: false, freedBytes: 0, deletedFiles: 0, errors: ["Target tidak ditemukan"] });
    return;
  }

  if (target.safeToDelete !== "safe") {
    onProgress({ id: target.id, name: target.name, success: false, freedBytes: 0, deletedFiles: 0, errors: ["Bukan kategori aman — dilewati"] });
    return;
  }

  const dirStat = await stat(target.path).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) {
    onProgress({ id: target.id, name: target.name, success: true, freedBytes: 0, deletedFiles: 0, errors: ["Folder tidak ada (sudah bersih)"] });
    return;
  }

  const { deleted, freed, errors } = await deleteDirContents(target.path);
  onProgress({ id: target.id, name: target.name, success: true, freedBytes: freed, deletedFiles: deleted, errors });
}

export interface CleanResult {
  id: string;
  name: string;
  success: boolean;
  freedBytes: number;
  deletedFiles: number;
  errors: string[];
}

export async function cleanTarget(id: string): Promise<CleanResult | null> {
  const target = TARGETS.find(t => t.id === id);
  if (!target) return null;

  // Hanya izinkan yang safeToDelete === "safe"
  if (target.safeToDelete !== "safe") {
    return {
      id: target.id,
      name: target.name,
      success: false,
      freedBytes: 0,
      deletedFiles: 0,
      errors: ["Folder ini tidak diizinkan untuk dibersihkan otomatis (bukan safe)."]
    };
  }

  const dirStat = await stat(target.path).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) {
    return {
      id: target.id,
      name: target.name,
      success: true,
      freedBytes: 0,
      deletedFiles: 0,
      errors: ["Folder tidak ditemukan (mungkin sudah bersih)."]
    };
  }

  const { deleted, freed, errors } = await deleteDirContents(target.path);
  return {
    id: target.id,
    name: target.name,
    success: true,
    freedBytes: freed,
    deletedFiles: deleted,
    errors
  };
}
