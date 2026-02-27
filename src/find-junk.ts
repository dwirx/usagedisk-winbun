import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";

// Daftar nama folder yang umumnya berisi file sementara, cache, atau hasil build (aman untuk dihapus)
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
  "coverage"
]);

// Daftar ekstensi atau nama file yang seringkali berupa log atau file sistem sementara
const JUNK_FILES = [
  ".log",
  "Thumbs.db",
  ".DS_Store",
  "npm-debug.log",
  "yarn-error.log"
];

interface JunkItem {
  path: string;
  size: number;
  type: "FOLDER" | "FILE";
  reason: string;
}

// Fungsi rekursif untuk menghitung ukuran direktori
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
    // Abaikan error akses
  }
  return size;
}

function formatBytes(bytes: number, decimals = 2): string {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function scanForJunk(targetDir: string) {
  console.log(`\n🧹 Mencari file/folder "sampah" (Cache, Temp, Log, node_modules) di: ${targetDir}`);
  console.log(`⏳ Memindai, ini mungkin memakan waktu tergantung banyaknya file...\n`);

  const junkFound: JunkItem[] = [];
  let totalJunkSize = 0;

  // Fungsi untuk memindai direktori utama
  async function scanDirectory(currentPath: string) {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        const name = entry.name.toLowerCase();

        if (entry.isDirectory()) {
          // Jika ini adalah direktori "sampah"
          if (JUNK_DIRS.has(name)) {
            const size = await getDirSize(fullPath);
            junkFound.push({
              path: fullPath,
              size,
              type: "FOLDER",
              reason: `Folder Cache/Build/Dependensi (${entry.name})`
            });
            totalJunkSize += size;
            // Kita TIDAK masuk (scanDirectory) ke dalam folder ini, karena seluruh isinya dianggap sampah
          } else {
            // Jika bukan folder sampah, telusuri lebih dalam
            // Abaikan folder hidden sistem seperti .git untuk kecepatan
            if (name !== ".git") {
              await scanDirectory(fullPath);
            }
          }
        } else {
          // Jika ini adalah file
          const isJunkFile = JUNK_FILES.some(junk => name.endsWith(junk.toLowerCase()));
          if (isJunkFile) {
            const fileStat = await stat(fullPath).catch(() => null);
            if (fileStat) {
              junkFound.push({
                path: fullPath,
                size: fileStat.size,
                type: "FILE",
                reason: `File Log/Temporary (${entry.name})`
              });
              totalJunkSize += fileStat.size;
            }
          }
        }
      }
    } catch (err) {
      // Abaikan error permission denied atau file terkunci
    }
  }

  await scanDirectory(targetDir);

  // Urutkan dari ukuran terbesar
  junkFound.sort((a, b) => b.size - a.size);

  if (junkFound.length === 0) {
    console.log("✨ Wah, penyimpanan Anda bersih! Tidak ada file/folder sampah yang ditemukan di sini.");
    return;
  }

  console.log("🗑️  Daftar Sampah/Cache Terbesar yang Ditemukan:");
  console.log("----------------------------------------------------------------------------------");

  // Tampilkan maksimal 20 item terbesar agar tidak spam
  for (const item of junkFound.slice(0, 20)) {
    const icon = item.type === "FOLDER" ? "📁" : "📄";
    console.log(`${icon} [${formatBytes(item.size).padStart(10)}] | ${item.path}`);
  }

  if (junkFound.length > 20) {
    console.log(`\n... dan ${junkFound.length - 20} item lainnya yang lebih kecil.`);
  }

  console.log("----------------------------------------------------------------------------------");
  console.log(`🔥 TOTAL POTENSI RUANG YANG BISA DIBEBASKAN: -> ${formatBytes(totalJunkSize)} <-`);
  console.log(`⚠️  PERHATIAN: Pastikan Anda memeriksa ulang folder di atas sebelum menghapusnya!`);
  console.log(`   (Biasanya aman menghapus node_modules/build/cache, tapi Anda harus install/build ulang project jika ingin mengerjakannya lagi)`);
}

const targetDirectory = process.argv[2] || process.cwd();
scanForJunk(targetDirectory);
