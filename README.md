# DiskClean

DiskClean adalah alat pembersihan disk berbasis antarmuka web yang super cepat, dirancang khusus untuk Developer (khususnya pengguna Windows). Aplikasi ini memindai drive C: Anda dan membantu membersihkan berbagai *cache*, file sementara (temp files), dan tumpukan file developer lainnya yang menghabiskan ruang penyimpanan (seperti `node_modules`, cache Bun/NPM, Cargo registry, dll).

Dibangun menggunakan teknologi terkini:
- **[Bun](https://bun.sh)**: Runtime JavaScript all-in-one yang sangat cepat dengan API bawaan (`Bun.serve()`, `Bun.file()`, dll).
- **React 19**: Framework frontend modern, di-serve langsung menggunakan bundler bawaan Bun tanpa memerlukan vite/webpack.
- **Oxc (`oxlint` & `oxfmt`)**: Tooling super cepat berbasis Rust untuk proses linter dan formatting.

## 🚀 Fitur Utama

- **Pemindaian Super Cepat**: Memanfaatkan performa native Bun untuk membaca sistem file.
- **Developer-Focused Cleaning**: Menargetkan direktori yang sering dipenuhi cache oleh developer seperti `npm-cache`, `.bun/install/cache`, `.cargo/registry`, dll.
- **Indikator Keamanan**: Folder ditandai dengan jelas apakah *Safe to Delete* (Aman), *Conditional* (Bersyarat), atau *Unsafe* (Tidak Aman).
- **Web UI Modern**: Antarmuka interaktif dan responsif langsung di browser.
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

### 3. Quality Control (Cek Kode)

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
