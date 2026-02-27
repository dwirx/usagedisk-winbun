import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const USER_DIR = homedir();

// "Penyakit" umum di Drive C (khususnya untuk Developer / Windows user)
const COMMON_BLOAT_DIRS = [
  { name: "Windows Temp", path: "C:\\Windows\\Temp", type: "System Cache" },
  { name: "User Temp", path: join(USER_DIR, "AppData", "Local", "Temp"), type: "User Cache" },
  { name: "Windows Update Cache", path: "C:\\Windows\\SoftwareDistribution\\Download", type: "System Cache" },
  { name: "Downloads Folder", path: join(USER_DIR, "Downloads"), type: "User Files" },
  { name: "Recycle Bin", path: "C:\\$Recycle.Bin", type: "System Trash" },

  // Developer caches (Penyakit programmer)
  { name: "NPM Cache", path: join(USER_DIR, "AppData", "Local", "npm-cache"), type: "Dev Cache" },
  { name: "Bun Cache", path: join(USER_DIR, ".bun", "install", "cache"), type: "Dev Cache" },
  { name: "Yarn Cache", path: join(USER_DIR, "AppData", "Local", "Yarn", "Cache"), type: "Dev Cache" },
  { name: "PNPM Store", path: join(USER_DIR, "AppData", "Local", "pnpm", "store"), type: "Dev Cache" },
  { name: "Cargo (Rust) Cache", path: join(USER_DIR, ".cargo", "registry"), type: "Dev Cache" },
  { name: "Gradle (Java) Cache", path: join(USER_DIR, ".gradle", "caches"), type: "Dev Cache" },
  { name: "Docker WSL Data", path: join(USER_DIR, "AppData", "Local", "Docker", "wsl", "data"), type: "Docker/VM" },
  { name: "Android Emulator", path: join(USER_DIR, ".android", "avd"), type: "Virtual Machine" },
  { name: "VS Code Cache", path: join(USER_DIR, "AppData", "Roaming", "Code", "Cache"), type: "Dev Cache" },

  // Browser caches
  { name: "Chrome Cache", path: join(USER_DIR, "AppData", "Local", "Google", "Chrome", "User Data", "Default", "Cache"), type: "Browser Cache" },
  { name: "Edge Cache", path: join(USER_DIR, "AppData", "Local", "Microsoft", "Edge", "User Data", "Default", "Cache"), type: "Browser Cache" },
];

async function getDirSize(dirPath: string): Promise<number> {
  let size = 0;
  try {
    const files = await readdir(dirPath, { withFileTypes: true });
    for (const file of files) {
      const fullPath = join(dirPath, file.name);
      if (file.isDirectory()) {
        size += await getDirSize(fullPath);
      } else {
        const stats = await stat(fullPath).catch(() => null);
        if (stats) size += stats.size;
      }
    }
  } catch (err) {
    // Abaikan file/folder yang diproteksi (Access Denied / EPERM / EBUSY)
  }
  return size;
}

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function analyzeCDrive() {
  console.log(`\n🩺 Mendiagnosis "Penyakit" Drive C pada sistem Windows Anda...`);
  console.log(`👤 User Dideteksi: ${USER_DIR}`);
  console.log(`⏳ Mengecek folder-folder tersangka utama. Mohon tunggu (ini mungkin memakan waktu 10-30 detik)...\n`);

  const results: { name: string; path: string; size: number; type: string }[] = [];
  let totalBloat = 0;

  // Cek secara paralel agar lebih cepat
  const promises = COMMON_BLOAT_DIRS.map(async (target) => {
    try {
      const dirStat = await stat(target.path).catch(() => null);
      if (dirStat && dirStat.isDirectory()) {
        const size = await getDirSize(target.path);
        if (size > 0) {
            results.push({ ...target, size });
            totalBloat += size;
        }
      }
    } catch (e) {}
  });

  await Promise.all(promises);

  // Urutkan dari yang paling memakan storage
  results.sort((a, b) => b.size - a.size);

  console.log("📊 Laporan Investigasi Penyakit Drive C:");
  console.log("==================================================================================");
  for (const res of results) {
    // Label merah untuk file di atas 500 MB, kuning di atas 100MB, hijau sisanya
    let indicator = "🟢";
    if (res.size > 500 * 1024 * 1024) indicator = "🔴";
    else if (res.size > 100 * 1024 * 1024) indicator = "🟡";

    console.log(`[${res.type.padEnd(15)}] | ${indicator} ${formatBytes(res.size).padStart(10)} | ${res.name}`);
    if (res.size > 10 * 1024 * 1024) { // Tampilkan path jika sizenya lebih dari 10MB
        console.log(`  └─ 📁 ${res.path}`);
    }
  }
  console.log("==================================================================================");
  console.log(`🚨 TOTAL UKURAN DARI FOLDER-FOLDER "TERDUGA": ${formatBytes(totalBloat)}\n`);

  console.log("💡 TIPS PENGOBATAN / CARA MEMBERSIHKANNYA:");
  console.log("-----------------------------------------");
  console.log("1. System Cache   : Buka Start Menu -> ketik 'Disk Cleanup' -> Centang 'Temporary files' & klik OK.");
  console.log("2. User Temp      : Tekan [Win + R], ketik %TEMP%, lalu hapus semua isinya (skip yang tak bisa dihapus).");
  console.log("3. NPM Cache      : Jika ada NPM Cache besar, jalankan command: 'npm cache clean --force'");
  console.log("4. Bun/Yarn/PNPM  : Hapus folder cachenya manual, atau jalankan command 'bun pm cache rm'");
  console.log("5. Downloads      : Periksa folder Downloads Anda, seringkali banyak installer .exe bekas yang menyiksa storage.\n");
}

analyzeCDrive();
