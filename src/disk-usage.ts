import { readdir, stat } from "fs/promises";
import { join } from "path";

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
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
        const fileStat = await stat(fullPath);
        size += fileStat.size;
      }
    }
  } catch {
    // Abaikan jika tidak ada akses/permission denied
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

async function analyzeStorage(targetDir: string): Promise<void> {
  writeLine(`\n🔍 Menganalisis penyimpanan di: ${targetDir}`);
  writeLine("⏳ Sedang menghitung, mohon tunggu sebentar...\n");

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const results: { name: string; size: number; isDir: boolean }[] = [];

    const tasks = entries.map(async (entry) => {
      const fullPath = join(targetDir, entry.name);
      try {
        if (entry.isDirectory()) {
          const size = await getDirSize(fullPath);
          results.push({ name: entry.name, size, isDir: true });
          return;
        }
        const fileStat = await stat(fullPath);
        results.push({ name: entry.name, size: fileStat.size, isDir: false });
      } catch {
        // Abaikan jika error membaca file/folder tertentu
      }
    });

    await Promise.all(tasks);
    results.sort((left, right) => right.size - left.size);

    writeLine("📊 Top 15 File/Folder Terbesar:");
    writeLine("------------------------------------------------");
    for (const result of results.slice(0, 15)) {
      const type = result.isDir ? "📁 [FOLDER]" : "📄 [FILE]  ";
      writeLine(
        `${type.padEnd(12)} | ${formatBytes(result.size).padStart(10)} | ${result.name}`,
      );
    }
    writeLine("------------------------------------------------\n");
  } catch (error) {
    writeError(
      `❌ Gagal membaca direktori: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

const targetDirectory = process.argv[2] || process.cwd();
void analyzeStorage(targetDirectory);
