import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

const USER_DIR = homedir();

const COMMON_BLOAT_DIRS = [
  { name: "Windows Temp", path: "C:\\Windows\\Temp", type: "System Cache" },
  {
    name: "User Temp",
    path: join(USER_DIR, "AppData", "Local", "Temp"),
    type: "User Cache",
  },
  {
    name: "Windows Update Cache",
    path: "C:\\Windows\\SoftwareDistribution\\Download",
    type: "System Cache",
  },
  {
    name: "Downloads Folder",
    path: join(USER_DIR, "Downloads"),
    type: "User Files",
  },
  { name: "Recycle Bin", path: "C:\\$Recycle.Bin", type: "System Trash" },
  {
    name: "NPM Cache",
    path: join(USER_DIR, "AppData", "Local", "npm-cache"),
    type: "Dev Cache",
  },
  {
    name: "Bun Cache",
    path: join(USER_DIR, ".bun", "install", "cache"),
    type: "Dev Cache",
  },
  {
    name: "Yarn Cache",
    path: join(USER_DIR, "AppData", "Local", "Yarn", "Cache"),
    type: "Dev Cache",
  },
  {
    name: "PNPM Store",
    path: join(USER_DIR, "AppData", "Local", "pnpm", "store"),
    type: "Dev Cache",
  },
  {
    name: "Cargo (Rust) Cache",
    path: join(USER_DIR, ".cargo", "registry"),
    type: "Dev Cache",
  },
  {
    name: "Gradle (Java) Cache",
    path: join(USER_DIR, ".gradle", "caches"),
    type: "Dev Cache",
  },
  {
    name: "Docker WSL Data",
    path: join(USER_DIR, "AppData", "Local", "Docker", "wsl", "data"),
    type: "Docker/VM",
  },
  {
    name: "Android Emulator",
    path: join(USER_DIR, ".android", "avd"),
    type: "Virtual Machine",
  },
  {
    name: "VS Code Cache",
    path: join(USER_DIR, "AppData", "Roaming", "Code", "Cache"),
    type: "Dev Cache",
  },
  {
    name: "Chrome Cache",
    path: join(
      USER_DIR,
      "AppData",
      "Local",
      "Google",
      "Chrome",
      "User Data",
      "Default",
      "Cache",
    ),
    type: "Browser Cache",
  },
  {
    name: "Edge Cache",
    path: join(
      USER_DIR,
      "AppData",
      "Local",
      "Microsoft",
      "Edge",
      "User Data",
      "Default",
      "Cache",
    ),
    type: "Browser Cache",
  },
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
        const fileStat = await stat(fullPath).catch(() => null);
        if (fileStat) {
          size += fileStat.size;
        }
      }
    }
  } catch {
    // Abaikan file/folder yang diproteksi
  }
  return size;
}

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) {
    return "0 Bytes";
  }
  const k = 1024;
  const precision = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(precision))} ${sizes[i]}`;
}

async function analyzeCDrive(): Promise<void> {
  writeLine('\n🩺 Mendiagnosis "Penyakit" Drive C pada sistem Windows Anda...');
  writeLine(`👤 User Dideteksi: ${USER_DIR}`);
  writeLine(
    "⏳ Mengecek folder-folder tersangka utama. Mohon tunggu (ini mungkin memakan waktu 10-30 detik)...\n",
  );

  const results: { name: string; path: string; size: number; type: string }[] =
    [];
  let totalBloat = 0;

  const tasks = COMMON_BLOAT_DIRS.map(async (target) => {
    try {
      const dirStat = await stat(target.path).catch(() => null);
      if (!dirStat || !dirStat.isDirectory()) {
        return;
      }

      const size = await getDirSize(target.path);
      if (size > 0) {
        results.push({ ...target, size });
        totalBloat += size;
      }
    } catch {
      // Abaikan target yang gagal dibaca
    }
  });

  await Promise.all(tasks);
  results.sort((left, right) => right.size - left.size);

  writeLine("📊 Laporan Investigasi Penyakit Drive C:");
  writeLine(
    "==================================================================================",
  );
  for (const result of results) {
    let indicator = "🟢";
    if (result.size > 500 * 1024 * 1024) {
      indicator = "🔴";
    } else if (result.size > 100 * 1024 * 1024) {
      indicator = "🟡";
    }

    writeLine(
      `[${result.type.padEnd(15)}] | ${indicator} ${formatBytes(result.size).padStart(10)} | ${result.name}`,
    );
    if (result.size > 10 * 1024 * 1024) {
      writeLine(`  └─ 📁 ${result.path}`);
    }
  }
  writeLine(
    "==================================================================================",
  );
  writeLine(
    `🚨 TOTAL UKURAN DARI FOLDER-FOLDER "TERDUGA": ${formatBytes(totalBloat)}\n`,
  );

  writeLine("💡 TIPS PENGOBATAN / CARA MEMBERSIHKANNYA:");
  writeLine("-----------------------------------------");
  writeLine(
    "1. System Cache   : Start Menu > ketik 'Disk Cleanup' > centang 'Temporary files' > OK.",
  );
  writeLine(
    "2. User Temp      : Tekan Win+R, ketik %TEMP%, lalu hapus semua isinya (skip yang tak bisa dihapus).",
  );
  writeLine("3. NPM Cache      : Jalankan 'npm cache clean --force'.");
  writeLine(
    "4. Bun/Yarn/PNPM  : Hapus cache manual atau jalankan 'bun pm cache rm'.",
  );
  writeLine(
    "5. Downloads      : Sortir folder Downloads berdasarkan ukuran terbesar dan hapus file tidak terpakai.\n",
  );
}

void analyzeCDrive();
