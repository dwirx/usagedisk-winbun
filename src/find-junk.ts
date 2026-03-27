import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

const JUNK_DIRS = new Set([
  "node_modules",
  ".cache",
  "temp",
  "tmp",
  ".temp",
  ".npm",
  ".yarn",
  ".pnpm-store",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
]);

const JUNK_FILES = [
  ".log",
  "Thumbs.db",
  ".DS_Store",
  "npm-debug.log",
  "yarn-error.log",
];

interface JunkItem {
  path: string;
  size: number;
  type: "FOLDER" | "FILE";
  reason: string;
}

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
    // Abaikan error akses
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

async function scanForJunk(targetDir: string): Promise<void> {
  writeLine(
    `\n🧹 Mencari file/folder "sampah" (Cache, Temp, Log, node_modules) di: ${targetDir}`,
  );
  writeLine(
    "⏳ Memindai, ini mungkin memakan waktu tergantung banyaknya file...\n",
  );

  const junkFound: JunkItem[] = [];
  let totalJunkSize = 0;

  async function scanDirectory(currentPath: string): Promise<void> {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        const normalized = entry.name.toLowerCase();

        if (entry.isDirectory()) {
          if (JUNK_DIRS.has(normalized)) {
            const size = await getDirSize(fullPath);
            junkFound.push({
              path: fullPath,
              size,
              type: "FOLDER",
              reason: `Folder Cache/Build/Dependensi (${entry.name})`,
            });
            totalJunkSize += size;
            continue;
          }

          if (normalized !== ".git") {
            await scanDirectory(fullPath);
          }
          continue;
        }

        const isJunkFile = JUNK_FILES.some((junk) =>
          normalized.endsWith(junk.toLowerCase()),
        );
        if (!isJunkFile) {
          continue;
        }

        const fileStat = await stat(fullPath).catch(() => null);
        if (!fileStat) {
          continue;
        }

        junkFound.push({
          path: fullPath,
          size: fileStat.size,
          type: "FILE",
          reason: `File Log/Temporary (${entry.name})`,
        });
        totalJunkSize += fileStat.size;
      }
    } catch {
      // Abaikan error permission denied atau file terkunci
    }
  }

  await scanDirectory(targetDir);
  junkFound.sort((left, right) => right.size - left.size);

  if (junkFound.length === 0) {
    writeLine(
      "✨ Penyimpanan Anda bersih. Tidak ada file/folder sampah yang ditemukan di lokasi ini.",
    );
    return;
  }

  writeLine("🗑️  Daftar Sampah/Cache Terbesar yang Ditemukan:");
  writeLine(
    "----------------------------------------------------------------------------------",
  );
  for (const item of junkFound.slice(0, 20)) {
    const icon = item.type === "FOLDER" ? "📁" : "📄";
    writeLine(
      `${icon} [${formatBytes(item.size).padStart(10)}] | ${item.path}`,
    );
  }

  if (junkFound.length > 20) {
    writeLine(
      `\n... dan ${junkFound.length - 20} item lainnya yang lebih kecil.`,
    );
  }

  writeLine(
    "----------------------------------------------------------------------------------",
  );
  writeLine(
    `🔥 TOTAL POTENSI RUANG YANG BISA DIBEBASKAN: -> ${formatBytes(totalJunkSize)} <-`,
  );
  writeLine(
    "⚠️  PERHATIAN: Pastikan Anda memeriksa ulang folder di atas sebelum menghapusnya!",
  );
  writeLine(
    "   (Biasanya aman menghapus node_modules/build/cache, tapi Anda harus install/build ulang project)",
  );
}

const targetDirectory = process.argv[2] || process.cwd();
void scanForJunk(targetDirectory);
