import { readdir, stat } from "fs/promises";
import { join } from "path";

// Fungsi untuk menghitung total ukuran direktori secara rekursif
async function getDirSize(dirPath: string): Promise<number> {
  let size = 0;
  try {
    const files = await readdir(dirPath, { withFileTypes: true });
    for (const file of files) {
      const fullPath = join(dirPath, file.name);
      if (file.isDirectory()) {
        size += await getDirSize(fullPath);
      } else {
        const stats = await stat(fullPath);
        size += stats.size;
      }
    }
  } catch (err) {
    // Abaikan jika tidak ada akses/permission denied
  }
  return size;
}

// Mengubah dari bytes ke KB, MB, GB dll dengan format yang pas
function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function analyzeStorage(targetDir: string) {
  console.log(`\n🔍 Menganalisis penyimpanan di: ${targetDir}`);
  console.log(`⏳ Sedang menghitung, mohon tunggu sebentar...\n`);

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const results: { name: string; size: number; isDir: boolean }[] = [];

    const promises = entries.map(async (entry) => {
      const fullPath = join(targetDir, entry.name);
      try {
        if (entry.isDirectory()) {
          const size = await getDirSize(fullPath);
          results.push({ name: entry.name, size, isDir: true });
        } else {
          const stats = await stat(fullPath);
          results.push({ name: entry.name, size: stats.size, isDir: false });
        }
      } catch (err) {
        // Abaikan jika error membaca
      }
    });

    await Promise.all(promises);

    // Urutkan dari yang terbesar ke terkecil
    results.sort((a, b) => b.size - a.size);

    console.log("📊 Top 15 File/Folder Terbesar:");
    console.log("------------------------------------------------");
    for (const res of results.slice(0, 15)) {
      const type = res.isDir ? "📁 [FOLDER]" : "📄 [FILE]  ";
      console.log(`${type.padEnd(12)} | ${formatBytes(res.size).padStart(10)} | ${res.name}`);
    }
    console.log("------------------------------------------------\n");
  } catch (error) {
    console.error("❌ Gagal membaca direktori:", error);
  }
}

// Ambil path dari argumen command line (atau gunakan current directory)
const targetDirectory = process.argv[2] || process.cwd();
analyzeStorage(targetDirectory);
