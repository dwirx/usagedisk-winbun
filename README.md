# DiskClean

DiskClean adalah alat pembersihan disk berbasis antarmuka web yang super cepat, dirancang khusus untuk Developer (khususnya pengguna Windows). Aplikasi ini memindai drive C: Anda dan membantu membersihkan berbagai _cache_, file sementara (temp files), dan tumpukan file developer lainnya yang menghabiskan ruang penyimpanan (seperti `node_modules`, cache Bun/NPM, Cargo registry, dll).

Dibangun menggunakan teknologi terkini:

- **[Bun](https://bun.sh)**: Runtime JavaScript all-in-one yang sangat cepat dengan API bawaan (`Bun.serve()`, `Bun.file()`, dll).
- **React 19**: Framework frontend modern, di-serve langsung menggunakan bundler bawaan Bun tanpa memerlukan vite/webpack.
- **Oxc (`oxlint` & `oxfmt`)**: Tooling super cepat berbasis Rust untuk proses linter dan formatting.

## 🚀 Fitur Utama

- **Pemindaian Super Cepat**: Memanfaatkan performa native Bun untuk membaca sistem file.
- **Developer-Focused Cleaning**: Menargetkan direktori yang sering dipenuhi cache oleh developer seperti `npm-cache`, `.bun/install/cache`, `.cargo/registry`, dll.
- **Target Lebih Lengkap**: Ditambah target populer lain seperti cache Playwright, NuGet (`.nuget/packages`), Brave cache, Delivery Optimization, hingga NVIDIA shader cache.
- **Target Lebih Luas Lagi**: Sekarang mencakup cache tambahan seperti DirectX shader cache, Windows thumbnail/icon cache, CrashDumps, Teams/Slack/Discord cache, Go build cache, Dart Pub cache, NuGet HTTP cache, dan lain-lain.
- **Indikator Keamanan**: Folder ditandai dengan jelas apakah _Safe to Delete_ (Aman), _Conditional_ (Bersyarat), atau _Unsafe_ (Tidak Aman).
- **Web UI Modern**: Antarmuka interaktif dan responsif langsung di browser.
- **Diagnostik Lebih Detail**: Hasil scan menampilkan jumlah target diperiksa, target tidak ditemukan, akses terbatas, dan item yang terlewati karena izin.
- **Progress Cleaning Streaming**: Proses pembersihan tampil realtime per target, termasuk hasil file terhapus dan ruang yang berhasil dibebaskan.
- **Buka Folder Langsung**: Tiap item bisa dibuka langsung di File Explorer dari UI.
- **Filter Analisis Detail**: Tersedia pencarian, filter status keamanan, filter ukuran minimum, dan panel prioritas aman terbesar.
- **Mode Scan WizTree**: Desktop build dapat memakai `wiztree_4_31_portable/WizTree64.exe` untuk export MFT cepat, bisa memilih EXE sendiri, atau mengunduh portable resmi jika belum tersedia.
- **Export Metafile & Cleanup Report**: Hasil scan dapat diekspor sebagai `metafile.json` kompatibel esbuild analyzer, plus report prioritas cleanup untuk review manual.
- **Zero Configuration Build**: Bun mengompilasi TypeScript dan React (JSX/TSX) secara instan.

## 🛠 Prerequisites

Pastikan Anda telah menginstal **[Bun](https://bun.sh/)** di sistem operasi Anda.

## 🚀 Cara Penggunaan

### 1. Instalasi Dependensi

Gunakan Bun untuk menginstal semua package yang dibutuhkan:

```bash
bun install
```

### 2. Menjalankan Proyek

Untuk menjalankan server pengembangan:

```bash
bun start
```

Aplikasi akan berjalan secara otomatis di `http://localhost:3000`.

### 3. Build Desktop Tauri

Untuk membuat installer Windows:

```bash
bun run desktop:build
```

Output build ada di:

- `src-tauri/target/release/bundle/nsis/usagedisk_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/usagedisk_0.1.0_x64_en-US.msi`

### 4. Quality Control (Cek Kode)

Template ini dilengkapi dengan pengecekan kode yang sangat cepat di `package.json`:

- **Jalankan Pengecekan Lengkap (Typecheck, Lint, Format):**
  ```bash
  bun run check
  ```
- **Perbaikan Otomatis (Lint & Format):**
  ```bash
  bun run fix
  ```

## 📂 Struktur Direktori

- `src/server.ts`: Backend server dan API menggunakan `Bun.serve()`.
- `src/frontend.tsx`: File frontend React utama.
- `src/scanner.ts`: Logika core untuk pemindaian sistem file dan perhitungan ukuran direktori.
- `src/index.html` & `src/index.css`: Template dasar HTML dan Stylesheet.
- `package.json`: Definisi dependensi dan scripts (Oxc & React).

## 📝 Lisensi

MIT
