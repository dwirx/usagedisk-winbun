import { readdir, rm, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { getErrorMessage, hasErrorCode } from "./error";
import { buildScanAssessment, canAutoClean } from "./scan-analysis";
import type {
  AvailabilityStatus,
  CleanResult,
  DiskInfo,
  OpenFolderResult,
  ScannedTarget,
  Target,
} from "./types";

const USER_DIR = homedir();
const CONCURRENCY = 32;

export const TARGETS: Target[] = [
  // ── SYSTEM CACHE ──────────────────────────────────────────────────────────
  {
    id: "windows_temp",
    name: "Windows Temp",
    path: "C:\\Windows\\Temp",
    type: "System Cache",
    icon: "🪟",
    description:
      "File sementara milik sistem Windows. Dibuat saat proses instalasi, update, atau error sistem. Salah satu tersangka klasik yang sering diabaikan.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Windows akan membuat ulang jika diperlukan. Skip file yang tidak bisa dihapus (sedang dipakai).",
    cleanCommand: "Disk Cleanup > 'Temporary files'",
  },
  {
    id: "user_temp",
    name: "User Temp (%TEMP%)",
    path: join(USER_DIR, "AppData", "Local", "Temp"),
    type: "System Cache",
    icon: "🧹",
    description:
      "File sementara milik akun Anda. Dibuat oleh browser, IDE, installer, dan hampir semua aplikasi. Sering diabaikan berbulan-bulan.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Tekan Win+R lalu ketik %TEMP% untuk membukanya langsung. Pilih semua (Ctrl+A) lalu Delete. Skip file yang tidak bisa dihapus.",
    cleanCommand: "Win+R > %TEMP% > Ctrl+A > Delete",
  },
  {
    id: "win_update",
    name: "Windows Update Cache",
    path: "C:\\Windows\\SoftwareDistribution\\Download",
    type: "System Cache",
    icon: "🔄",
    description:
      "File paket update Windows yang sudah terinstall namun tidak dibersihkan. Bisa mencapai belasan GB dan sering jadi biang utama!",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus setelah update selesai. Cara terbaik: jalankan Disk Cleanup sebagai Administrator, lalu pilih 'Windows Update Cleanup'.",
    cleanCommand: "Disk Cleanup (Admin) > 'Windows Update Cleanup'",
  },
  {
    id: "delivery_optimization",
    name: "Delivery Optimization Cache",
    path: "C:\\Windows\\SoftwareDistribution\\DeliveryOptimization\\Cache",
    type: "System Cache",
    icon: "🚚",
    description:
      "Cache peer-to-peer update Windows (Delivery Optimization). Folder ini bisa membesar setelah banyak update.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Windows akan mengunduh ulang cache ini jika dibutuhkan di update berikutnya.",
    cleanCommand:
      "Settings > Windows Update > Advanced options > Delivery Optimization > Clear cache",
  },
  {
    id: "prefetch",
    name: "Prefetch",
    path: "C:\\Windows\\Prefetch",
    type: "System Cache",
    icon: "⚡",
    description:
      "Data cache Windows untuk mempercepat loading aplikasi yang sering dipakai. Umumnya kecil, tapi ada di setiap Windows.",
    safeToDelete: "conditional",
    safeNote:
      "Boleh dihapus. Aplikasi akan terasa sedikit lebih lambat dibuka pertama kali sampai cache terbentuk lagi secara otomatis.",
    cleanCommand: "Disk Cleanup > 'Temporary files'",
  },
  {
    id: "win_installer",
    name: "Windows Installer Cache",
    path: "C:\\Windows\\Installer",
    type: "System Cache",
    icon: "📦",
    description:
      "Berisi file installer (.msi, .msp) dari semua program yang pernah terinstall. Dibutuhkan untuk uninstall/repair. Bisa mencapai 5-20 GB!",
    safeToDelete: "unsafe",
    safeNote:
      "JANGAN HAPUS sembarangan! Jika dihapus, Anda tidak bisa uninstall atau repair program tertentu. Gunakan tool khusus seperti 'PatchCleaner' untuk membersihkan yang orphaned saja.",
    cleanCommand:
      "Gunakan PatchCleaner (tool gratis) untuk hapus orphaned installer",
  },
  {
    id: "win_error_reports",
    name: "Windows Error Reports",
    path: join(USER_DIR, "AppData", "Local", "Microsoft", "Windows", "WER"),
    type: "System Cache",
    icon: "💥",
    description:
      "Log laporan crash dan error semua aplikasi Windows. Tidak berguna bagi pengguna biasa dan terus menumpuk.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Ini hanya log untuk dikirim ke Microsoft. Tidak mempengaruhi fungsi apapun.",
    cleanCommand: "Disk Cleanup > 'Windows Error Reporting Files'",
  },
  {
    id: "windows_thumbnail_cache",
    name: "Windows Thumbnail & Icon Cache",
    path: join(
      USER_DIR,
      "AppData",
      "Local",
      "Microsoft",
      "Windows",
      "Explorer",
    ),
    type: "System Cache",
    icon: "🖼️",
    description:
      "Cache thumbnail dan icon Explorer Windows. Bisa membengkak jika sering buka folder gambar/video besar.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Thumbnail/icon akan dibuat ulang otomatis oleh Windows saat dibutuhkan.",
    cleanCommand: "Disk Cleanup > Thumbnails",
  },
  {
    id: "directx_shader_cache",
    name: "DirectX Shader Cache",
    path: join(USER_DIR, "AppData", "Local", "D3DSCache"),
    type: "System Cache",
    icon: "🎛️",
    description:
      "Cache shader DirectX untuk aplikasi 3D/game. Dapat menumpuk seiring waktu.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Shader akan dikompilasi ulang saat game/aplikasi dijalankan kembali.",
    cleanCommand:
      "Settings > System > Storage > Temporary files > DirectX Shader Cache",
  },
  {
    id: "internet_cache",
    name: "Windows INet Cache",
    path: join(
      USER_DIR,
      "AppData",
      "Local",
      "Microsoft",
      "Windows",
      "INetCache",
    ),
    type: "System Cache",
    icon: "🌍",
    description:
      "Cache internet legacy Windows/WebView. Umumnya aman dibersihkan dan sering terabaikan.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Konten cache akan diunduh ulang secara otomatis saat dibutuhkan.",
    cleanCommand:
      "Settings > Privacy & security > Clear browsing data (WebView/browser)",
  },
  {
    id: "crash_dumps",
    name: "Crash Dumps (User)",
    path: join(USER_DIR, "AppData", "Local", "CrashDumps"),
    type: "System Cache",
    icon: "🧯",
    description:
      "File dump crash aplikasi user. Ukurannya bisa sangat besar setelah beberapa kali crash.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus jika Anda tidak sedang melakukan debugging crash aplikasi.",
    cleanCommand: "Hapus isi folder CrashDumps secara manual",
  },
  {
    id: "cbs_logs",
    name: "Windows CBS Logs",
    path: "C:\\Windows\\Logs\\CBS",
    type: "System Cache",
    icon: "📜",
    description:
      "Log servicing component Windows (CBS). Dapat menumpuk setelah update/repair system.",
    safeToDelete: "conditional",
    safeNote:
      "Boleh dibersihkan jika tidak dipakai troubleshooting. Simpan jika Anda sedang investigasi error update Windows.",
    cleanCommand:
      "Disk Cleanup atau hapus file log lama di C:\\Windows\\Logs\\CBS",
  },
  {
    id: "iis_logs",
    name: "IIS Server Logs",
    path: "C:\\inetpub\\logs\\LogFiles",
    type: "System Cache",
    icon: "🌐",
    description:
      "Log akses web server IIS (Internet Information Services). Jika Anda tidak aktif pakai IIS, log ini bisa menumpuk hingga GB.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus jika Anda tidak butuh audit log akses web. Hapus file .log lama, sisakan yang baru jika perlu.",
    cleanCommand:
      "Hapus file *.log di C:\\inetpub\\logs\\LogFiles secara manual",
  },

  // ── USER FILES ─────────────────────────────────────────────────────────────
  {
    id: "downloads",
    name: "Folder Downloads",
    path: join(USER_DIR, "Downloads"),
    type: "User Files",
    icon: "📥",
    description:
      "Folder Downloads Anda. Seringkali penuh dengan installer .exe, file .zip, video, PDF yang sudah tidak terpakai. Wajib diperiksa!",
    safeToDelete: "conditional",
    safeNote:
      "Periksa dulu satu per satu! Sortir berdasarkan ukuran terbesar. Hapus installer & file yang tidak dibutuhkan.",
    cleanCommand: "File Explorer > Downloads > Sortir by Size > Hapus manual",
  },
  {
    id: "recycle_bin",
    name: "Recycle Bin",
    path: "C:\\$Recycle.Bin",
    type: "System Trash",
    icon: "🗑️",
    description:
      "File yang sudah Anda hapus namun masih tersimpan di Recycle Bin. Tidak benar-benar gratis sampai Recycle Bin dikosongkan.",
    safeToDelete: "safe",
    safeNote:
      "100% Aman dikosongkan. Klik kanan ikon Recycle Bin di Desktop > Empty Recycle Bin.",
    cleanCommand: "Klik kanan Recycle Bin di Desktop > Empty Recycle Bin",
  },

  // ── DEV CACHE ──────────────────────────────────────────────────────────────
  {
    id: "npm_cache",
    name: "NPM Cache",
    path: join(USER_DIR, "AppData", "Local", "npm-cache"),
    type: "Dev Cache",
    icon: "📦",
    description:
      "Cache package NPM (Node.js). Menumpuk dari setiap kali 'npm install' dijalankan di manapun. Developer sering kaget betapa besarnya.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. NPM akan download ulang package saat install berikutnya. Project yang sudah ada tidak terpengaruh.",
    cleanCommand: "npm cache clean --force",
  },
  {
    id: "bun_cache",
    name: "Bun Cache",
    path: join(USER_DIR, ".bun", "install", "cache"),
    type: "Dev Cache",
    icon: "🍞",
    description:
      "Cache package Bun. Runtime JavaScript modern yang sangat cepat tapi juga menumpuk cache.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Bun akan download ulang saat diperlukan.",
    cleanCommand: "bun pm cache rm",
  },
  {
    id: "yarn_cache",
    name: "Yarn Cache",
    path: join(USER_DIR, "AppData", "Local", "Yarn", "Cache"),
    type: "Dev Cache",
    icon: "🧶",
    description:
      "Cache package Yarn. Sering terlupakan karena lokasinya tersembunyi di AppData.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Yarn akan download ulang saat diperlukan.",
    cleanCommand: "yarn cache clean",
  },
  {
    id: "pnpm_store",
    name: "PNPM Store",
    path: join(USER_DIR, "AppData", "Local", "pnpm", "store"),
    type: "Dev Cache",
    icon: "🗄️",
    description:
      "Store terpusat PNPM. Semua project PNPM berbagi store ini, sehingga bisa sangat besar namun juga efisien.",
    safeToDelete: "conditional",
    safeNote:
      "Hati-hati! Store ini dipakai bersama semua project PNPM aktif. Gunakan 'pnpm store prune' untuk hapus yang sudah tidak direferensikan saja.",
    cleanCommand: "pnpm store prune",
  },
  {
    id: "playwright_cache",
    name: "Playwright Browser Cache",
    path: join(USER_DIR, "AppData", "Local", "ms-playwright"),
    type: "Dev Cache",
    icon: "🎭",
    description:
      "Cache browser binary Playwright untuk testing automation (Chromium/Firefox/WebKit). Mudah membengkak jika sering update versi.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Saat test berikutnya Playwright akan download ulang browser binary yang dibutuhkan.",
    cleanCommand:
      "Hapus folder AppData\\Local\\ms-playwright atau jalankan npx playwright uninstall --all",
  },
  {
    id: "pip_cache",
    name: "Python PIP Cache",
    path: join(USER_DIR, "AppData", "Local", "pip", "Cache"),
    type: "Dev Cache",
    icon: "🐍",
    description:
      "Cache package Python (pip). Jika Anda sering install library Python / data science, ini bisa cukup besar.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. PIP akan download ulang package saat install berikutnya.",
    cleanCommand: "pip cache purge",
  },
  {
    id: "maven_cache",
    name: "Maven Repository (Java)",
    path: join(USER_DIR, ".m2", "repository"),
    type: "Dev Cache",
    icon: "☕",
    description:
      "Repository lokal Maven untuk project Java/Spring. Setiap dependency Java tersimpan di sini dan bisa mencapai GB.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Maven akan download ulang JAR yang dibutuhkan saat build berikutnya (build pertama lebih lama).",
    cleanCommand: "Hapus folder .m2\\repository secara manual",
  },
  {
    id: "gradle_cache",
    name: "Gradle Cache (Java/Android)",
    path: join(USER_DIR, ".gradle", "caches"),
    type: "Dev Cache",
    icon: "🤖",
    description:
      "Cache build tool Gradle untuk Java & Android Studio. Bisa mencapai 5-15 GB tanpa disadari, terutama developer Android.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Gradle akan rebuild cache saat build project berikutnya (build pertama akan lebih lama).",
    cleanCommand: "Hapus folder .gradle\\caches secara manual",
  },
  {
    id: "cargo_registry",
    name: "Cargo Registry (Rust)",
    path: join(USER_DIR, ".cargo", "registry"),
    type: "Dev Cache",
    icon: "🦀",
    description:
      "Cache package Rust (Cargo crates). Bisa sangat besar jika aktif mengembangkan aplikasi Rust.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Cargo akan download ulang saat build project Rust berikutnya.",
    cleanCommand: "cargo cache --autoclean",
  },
  {
    id: "nuget_packages",
    name: ".NET NuGet Packages",
    path: join(USER_DIR, ".nuget", "packages"),
    type: "Dev Cache",
    icon: "🟣",
    description:
      "Cache package NuGet global untuk .NET. Makin banyak project .NET, makin besar folder ini.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Paket akan diunduh ulang saat restore/build project .NET berikutnya.",
    cleanCommand: "dotnet nuget locals global-packages --clear",
  },
  {
    id: "nuget_http_cache",
    name: ".NET NuGet HTTP Cache",
    path: join(USER_DIR, "AppData", "Local", "NuGet", "v3-cache"),
    type: "Dev Cache",
    icon: "📡",
    description:
      "Cache metadata/download NuGet. Terakumulasi seiring restore package .NET.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. NuGet akan mengambil ulang metadata saat restore berikutnya.",
    cleanCommand: "dotnet nuget locals http-cache --clear",
  },
  {
    id: "go_build_cache",
    name: "Go Build Cache",
    path: join(USER_DIR, "AppData", "Local", "go-build"),
    type: "Dev Cache",
    icon: "🐹",
    description:
      "Cache hasil kompilasi sementara bahasa Go. Biasanya aman dibersihkan kapan saja.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Go akan membangun ulang cache saat build/test berikutnya.",
    cleanCommand: "go clean -cache",
  },
  {
    id: "dart_pub_cache",
    name: "Dart/Flutter Pub Cache",
    path: join(USER_DIR, "AppData", "Local", "Pub", "Cache"),
    type: "Dev Cache",
    icon: "🎯",
    description:
      "Cache package Dart/Flutter dari pub.dev. Dapat membesar jika banyak project Flutter.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Package akan di-download ulang saat pub get berikutnya.",
    cleanCommand: "dart pub cache clean",
  },
  {
    id: "rustup_downloads",
    name: "Rustup Downloads Cache",
    path: join(USER_DIR, ".rustup", "downloads"),
    type: "Dev Cache",
    icon: "🦀",
    description:
      "Cache file download toolchain rustup. Aman dibersihkan untuk hemat ruang.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Rustup akan mengunduh ulang jika membutuhkan file yang sama.",
    cleanCommand: "rustup self uninstall / hapus cache downloads manual",
  },
  {
    id: "jetbrains_cache",
    name: "JetBrains IDE Cache",
    path: join(USER_DIR, "AppData", "Local", "JetBrains"),
    type: "Dev Cache",
    icon: "🧠",
    description:
      "Cache semua produk JetBrains (IntelliJ, WebStorm, PyCharm, GoLand, dll). Index & cache IDE yang sangat besar.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. IDE akan membangun ulang index saat pertama dibuka (beberapa menit).",
    cleanCommand:
      "File > Invalidate Caches > Invalidate and Restart (dari dalam IDE)",
  },
  {
    id: "vscode_cache",
    name: "VS Code Cache",
    path: join(USER_DIR, "AppData", "Roaming", "Code", "Cache"),
    type: "Dev Cache",
    icon: "💻",
    description:
      "Cache editor VS Code: ekstensi, indexing workspace, dan file yang pernah dibuka.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. VS Code akan membuat cache baru. Ekstensi dan pengaturan tidak hilang.",
    cleanCommand: "Help > Toggle Developer Tools > Application > Clear Storage",
  },

  // ── BROWSER CACHE ──────────────────────────────────────────────────────────
  {
    id: "chrome_cache",
    name: "Google Chrome Cache",
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
    icon: "🌐",
    description:
      "Cache browser Chrome: gambar, video, script, dan halaman web yang pernah dikunjungi. Terus bertambah setiap browsing.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Website akan terasa sedikit lebih lambat dibuka pertama kali, tapi tidak ada data penting yang hilang.",
    cleanCommand:
      "Chrome: Ctrl+Shift+Delete > Cached images and files > Clear data",
  },
  {
    id: "edge_cache",
    name: "Microsoft Edge Cache",
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
    icon: "🌀",
    description:
      "Cache browser Microsoft Edge. Mirip Chrome karena berbasis Chromium.",
    safeToDelete: "safe",
    safeNote: "Aman dihapus. Tidak ada data penting yang hilang.",
    cleanCommand:
      "Edge: Ctrl+Shift+Delete > Cached images and files > Clear now",
  },
  {
    id: "brave_cache",
    name: "Brave Browser Cache",
    path: join(
      USER_DIR,
      "AppData",
      "Local",
      "BraveSoftware",
      "Brave-Browser",
      "User Data",
      "Default",
      "Cache",
    ),
    type: "Browser Cache",
    icon: "🦁",
    description:
      "Cache browser Brave yang berbasis Chromium. Mirip pola cache Chrome/Edge.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Brave akan mengunduh ulang cache web secara otomatis.",
    cleanCommand:
      "Brave: Ctrl+Shift+Delete > Cached images and files > Clear data",
  },
  {
    id: "firefox_cache",
    name: "Firefox Cache",
    path: join(USER_DIR, "AppData", "Local", "Mozilla", "Firefox", "Profiles"),
    type: "Browser Cache",
    icon: "🦊",
    description:
      "Cache browser Firefox yang tersimpan di dalam folder profile.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus via menu Firefox. Jangan hapus folder profile secara manual.",
    cleanCommand: "Firefox: Ctrl+Shift+Delete > Cache > Clear Now",
  },

  // ── APP CACHE ──────────────────────────────────────────────────────────────
  {
    id: "discord_cache",
    name: "Discord Cache",
    path: join(USER_DIR, "AppData", "Roaming", "discord", "Cache"),
    type: "App Cache",
    icon: "💬",
    description:
      "Cache aplikasi Discord (gambar, media, web assets). Dapat membesar dari aktivitas harian.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus saat Discord ditutup. Aset akan diunduh ulang saat aplikasi dibuka lagi.",
    cleanCommand: "Tutup Discord > hapus folder Cache",
  },
  {
    id: "slack_cache",
    name: "Slack Cache",
    path: join(USER_DIR, "AppData", "Roaming", "Slack", "Cache"),
    type: "App Cache",
    icon: "🧵",
    description:
      "Cache aplikasi Slack. Ukuran bisa naik dari file preview, media, dan history channel.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus setelah Slack ditutup. Data akan disinkron ulang saat login kembali.",
    cleanCommand: "Tutup Slack > hapus folder Cache",
  },
  {
    id: "teams_cache",
    name: "Microsoft Teams Cache (Classic)",
    path: join(USER_DIR, "AppData", "Roaming", "Microsoft", "Teams", "Cache"),
    type: "App Cache",
    icon: "👥",
    description:
      "Cache aplikasi Teams klasik (web assets, media, temporary files).",
    safeToDelete: "safe",
    safeNote:
      "Aman dibersihkan saat Teams ditutup. Teams akan membuat ulang cache saat startup.",
    cleanCommand: "Keluar dari Teams > hapus folder Cache",
  },

  // ── VIRTUAL MACHINE & GAME ─────────────────────────────────────────────────
  {
    id: "docker_wsl",
    name: "Docker WSL Data",
    path: join(USER_DIR, "AppData", "Local", "Docker", "wsl", "data"),
    type: "Virtual Machine",
    icon: "🐳",
    description:
      "File virtual disk Docker Desktop (WSL2). Sering menjadi penyebab utama Drive C penuh karena file .vhdx tidak menyusut otomatis.",
    safeToDelete: "conditional",
    safeNote:
      "JANGAN hapus folder langsung. Hapus image/container tak terpakai via 'docker system prune -a', lalu shrink disk via WSL.",
    cleanCommand: "docker system prune -a --volumes",
  },
  {
    id: "android_avd",
    name: "Android Emulator (AVD)",
    path: join(USER_DIR, ".android", "avd"),
    type: "Virtual Machine",
    icon: "📱",
    description:
      "File image virtual device Android. Setiap satu emulator bisa menghabiskan 4-10 GB. Jika punya banyak AVD, ini biang kerok utama.",
    safeToDelete: "conditional",
    safeNote:
      "Hapus AVD yang tidak digunakan via Android Studio: Device Manager > pilih AVD > klik Delete.",
    cleanCommand:
      "Android Studio > Device Manager > Hapus AVD yang tidak dipakai",
  },
  {
    id: "steam_shader",
    name: "Steam Shader Cache",
    path: join(USER_DIR, "AppData", "Local", "Steam", "htmlcache"),
    type: "Game Cache",
    icon: "🎮",
    description:
      "Cache shader dan HTML milik Steam client. Bisa membengkak dari setiap game yang dimainkan.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Steam akan rebuild cache saat dibuka kembali. Tidak mempengaruhi save game.",
    cleanCommand: "Steam: Settings > Downloads > Clear Download Cache",
  },
  {
    id: "epic_cache",
    name: "Epic Games Cache",
    path: join(
      USER_DIR,
      "AppData",
      "Local",
      "EpicGamesLauncher",
      "Saved",
      "webcache",
    ),
    type: "Game Cache",
    icon: "🎯",
    description:
      "Cache launcher Epic Games Store. Menumpuk dari browsing store dan update launcher.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Epic Games Launcher akan rebuild cache saat dibuka ulang.",
    cleanCommand:
      "Hapus folder webcache secara manual lalu restart Epic Launcher",
  },
  {
    id: "nvidia_shader_cache",
    name: "NVIDIA Shader Cache",
    path: join(USER_DIR, "AppData", "Local", "NVIDIA", "DXCache"),
    type: "Game Cache",
    icon: "🖼️",
    description:
      "Cache shader GPU NVIDIA dari game/aplikasi 3D. Dapat menumpuk cukup besar setelah banyak game dijalankan.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Shader akan dikompilasi ulang ketika game/aplikasi dijalankan lagi.",
    cleanCommand:
      "NVIDIA Control Panel > Manage 3D settings > Shader Cache Size / reset cache",
  },
  {
    id: "nvidia_gl_cache",
    name: "NVIDIA OpenGL Cache",
    path: join(USER_DIR, "AppData", "Local", "NVIDIA", "GLCache"),
    type: "Game Cache",
    icon: "🧩",
    description:
      "Cache OpenGL NVIDIA. Terkadang tumbuh besar setelah banyak menjalankan aplikasi/game OpenGL.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Driver akan membangun ulang cache sesuai kebutuhan.",
    cleanCommand:
      "Reset shader cache dari NVIDIA Control Panel / hapus folder GLCache",
  },
  {
    id: "amd_shader_cache",
    name: "AMD Shader Cache",
    path: join(USER_DIR, "AppData", "Local", "AMD", "DxCache"),
    type: "Game Cache",
    icon: "🕹️",
    description:
      "Cache shader GPU AMD untuk game/aplikasi DirectX. Bisa memakan ruang signifikan.",
    safeToDelete: "safe",
    safeNote:
      "Aman dihapus. Shader akan dikompilasi ulang saat aplikasi dijalankan kembali.",
    cleanCommand: "AMD Software > Graphics > Reset Shader Cache",
  },
];

const TARGETS_BY_ID = new Map(
  TARGETS.map((target) => [target.id, target] as const),
);

interface SizeScanResult {
  size: number;
  files: number;
  skippedItems: number;
}

interface DeleteResult {
  deleted: number;
  freed: number;
  errors: string[];
}

function parseDiskInfoFromCsv(output: string): DiskInfo | null {
  const lines = output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line.includes(",") && !line.toLowerCase().includes("freespace"),
    );

  if (lines.length === 0) {
    return null;
  }

  const firstLine = lines[0];
  if (!firstLine) {
    return null;
  }

  const parts = firstLine.split(",");
  if (parts.length < 3) {
    return null;
  }

  const freeRaw = parts[1];
  const totalRaw = parts[2];
  if (!freeRaw || !totalRaw) {
    return null;
  }

  const free = Number.parseInt(freeRaw.trim(), 10);
  const total = Number.parseInt(totalRaw.trim(), 10);

  if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return { total, free, used: total - free };
}

async function getDirSizeAndCount(dirPath: string): Promise<SizeScanResult> {
  let size = 0;
  let files = 0;
  let skippedItems = 0;

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return { size, files, skippedItems: 1 };
  }

  const subDirs: string[] = [];
  const filePaths: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      subDirs.push(join(dirPath, entry.name));
      continue;
    }
    filePaths.push(join(dirPath, entry.name));
  }

  for (let i = 0; i < subDirs.length; i += CONCURRENCY) {
    const batch = subDirs.slice(i, i + CONCURRENCY);
    const subResults = await Promise.all(
      batch.map((path) => getDirSizeAndCount(path)),
    );
    for (const subResult of subResults) {
      size += subResult.size;
      files += subResult.files;
      skippedItems += subResult.skippedItems;
    }
  }

  for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
    const batch = filePaths.slice(i, i + CONCURRENCY);
    const statResults = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const fileStat = await stat(filePath);
          return { size: fileStat.size, skipped: false };
        } catch {
          return { size: 0, skipped: true };
        }
      }),
    );

    for (const statResult of statResults) {
      if (statResult.skipped) {
        skippedItems++;
        continue;
      }
      size += statResult.size;
      files++;
    }
  }

  return { size, files, skippedItems };
}

async function deleteDirContents(dirPath: string): Promise<DeleteResult> {
  const errors: string[] = [];
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    return {
      deleted: 0,
      freed: 0,
      errors: [getErrorMessage(error, "Tidak bisa buka folder")],
    };
  }

  const results = await Promise.all(
    entries.map(async (entry): Promise<DeleteResult> => {
      const fullPath = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const subResult = await getDirSizeAndCount(fullPath);
          await rm(fullPath, { recursive: true, force: true });
          return {
            deleted: subResult.files,
            freed: subResult.size,
            errors: [],
          };
        }

        const fileStat = await stat(fullPath);
        await unlink(fullPath);
        return { deleted: 1, freed: fileStat.size, errors: [] };
      } catch (error) {
        return {
          deleted: 0,
          freed: 0,
          errors: [`${entry.name}: ${getErrorMessage(error, "gagal")}`],
        };
      }
    }),
  );

  let deleted = 0;
  let freed = 0;
  for (const result of results) {
    deleted += result.deleted;
    freed += result.freed;
    errors.push(...result.errors);
  }

  return { deleted, freed, errors };
}

function buildMissingScan(target: Target): ScannedTarget {
  return buildScannedTarget(target, {
    availabilityStatus: "missing",
    files: 0,
    scanNote: "Folder tidak ditemukan di mesin ini.",
    size: 0,
    skippedItems: 0,
  });
}

function buildInaccessibleScan(
  target: Target,
  errorMessage: string,
): ScannedTarget {
  return buildScannedTarget(target, {
    availabilityStatus: "inaccessible",
    files: 0,
    scanNote: `Folder ada, tetapi tidak dapat diakses: ${errorMessage}`,
    size: 0,
    skippedItems: 0,
  });
}

function buildScannedTarget(
  target: Target,
  input: {
    availabilityStatus: AvailabilityStatus;
    files: number;
    scanNote?: string;
    size: number;
    skippedItems: number;
  },
): ScannedTarget {
  const assessment = buildScanAssessment({
    availabilityStatus: input.availabilityStatus,
    files: input.files,
    safeToDelete: target.safeToDelete,
    size: input.size,
    skippedItems: input.skippedItems,
  });

  return {
    ...target,
    size: input.size,
    files: input.files,
    skippedItems: input.skippedItems,
    availabilityStatus: input.availabilityStatus,
    scanNote: input.scanNote,
    isEstimate: false,
    deepScanCompleted: true,
    scanModeUsed: "deep",
    recommendation: assessment.recommendation,
    riskLevel: assessment.riskLevel,
    reason: assessment.reason,
    evidence: assessment.evidence,
  };
}

async function scanTarget(target: Target): Promise<ScannedTarget> {
  let targetStat: Awaited<ReturnType<typeof stat>>;
  try {
    targetStat = await stat(target.path);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return buildMissingScan(target);
    }
    return buildInaccessibleScan(
      target,
      getErrorMessage(error, "izin ditolak"),
    );
  }

  if (!targetStat.isDirectory()) {
    return buildInaccessibleScan(target, "path bukan folder");
  }

  const sizeResult = await getDirSizeAndCount(target.path);
  const scanNote =
    sizeResult.skippedItems > 0
      ? `${sizeResult.skippedItems.toLocaleString("id-ID")} item tidak bisa diakses saat pemindaian.`
      : undefined;

  return buildScannedTarget(target, {
    availabilityStatus: "available",
    files: sizeResult.files,
    scanNote,
    size: sizeResult.size,
    skippedItems: sizeResult.skippedItems,
  });
}

function buildBlockedCleanResult(
  target: Pick<Target, "id" | "name">,
  message: string,
  estimatedBytes = 0,
  remainingBytes = 0,
): CleanResult {
  return {
    id: target.id,
    name: target.name,
    success: false,
    freedBytes: 0,
    deletedFiles: 0,
    errors: [message],
    estimatedBytes,
    remainingBytes,
    verificationStatus: "blocked",
    verificationNote: message,
  };
}

async function cleanVerifiedTarget(target: Target): Promise<CleanResult> {
  const beforeScan = await scanTarget(target);
  if (!canAutoClean(beforeScan.recommendation)) {
    return buildBlockedCleanResult(
      target,
      beforeScan.reason,
      beforeScan.size,
      beforeScan.size,
    );
  }

  const { deleted, freed, errors } = await deleteDirContents(target.path);
  const afterScan = await scanTarget(target);
  const verificationStatus =
    afterScan.availabilityStatus === "available" && afterScan.size === 0
      ? "verified"
      : "partial";
  const verificationNote =
    verificationStatus === "verified"
      ? "Preflight dan verifikasi pasca-clean lolos."
      : "Sebagian data masih tersisa atau tidak bisa diverifikasi penuh setelah clean.";

  return {
    id: target.id,
    name: target.name,
    success: verificationStatus === "verified",
    freedBytes: freed,
    deletedFiles: deleted,
    errors,
    estimatedBytes: beforeScan.size,
    remainingBytes: afterScan.size,
    verificationStatus,
    verificationNote,
  };
}

export function getTargetById(id: string): Target | undefined {
  return TARGETS_BY_ID.get(id);
}

export async function getDiskInfo(): Promise<DiskInfo> {
  try {
    const output =
      await Bun.$`wmic logicaldisk where "DeviceID='C:'" get Size,FreeSpace /format:csv`
        .quiet()
        .text();
    const parsed = parseDiskInfoFromCsv(output);
    if (parsed) {
      return parsed;
    }
  } catch {
    // fallback jika command tidak tersedia
  }

  return { total: 0, free: 0, used: 0 };
}

export async function scanSingleTarget(
  id: string,
): Promise<ScannedTarget | null> {
  const target = getTargetById(id);
  if (!target) {
    return null;
  }

  return scanTarget(target);
}

export async function cleanTargetStream(
  id: string,
  onProgress: (result: CleanResult) => void,
): Promise<void> {
  const target = getTargetById(id);
  if (!target) {
    onProgress(
      buildBlockedCleanResult({ id, name: id }, "Target tidak ditemukan"),
    );
    return;
  }

  onProgress(await cleanVerifiedTarget(target));
}

export async function cleanTarget(id: string): Promise<CleanResult | null> {
  const target = getTargetById(id);
  if (!target) {
    return null;
  }

  return cleanVerifiedTarget(target);
}

export async function openTargetFolder(
  id: string,
): Promise<OpenFolderResult | null> {
  const target = getTargetById(id);
  if (!target) {
    return null;
  }

  if (process.platform !== "win32") {
    return {
      opened: false,
      message: "Fitur buka folder saat ini khusus Windows.",
      path: target.path,
    };
  }

  try {
    const targetStat = await stat(target.path);
    if (!targetStat.isDirectory()) {
      return {
        opened: false,
        message: "Path target bukan folder.",
        path: target.path,
      };
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return {
        opened: false,
        message: "Folder tidak ditemukan di mesin ini.",
        path: target.path,
      };
    }
    return {
      opened: false,
      message: getErrorMessage(error, "Folder tidak bisa diakses."),
      path: target.path,
    };
  }

  try {
    await Bun.$`explorer ${target.path}`.quiet();
    return {
      opened: true,
      message: "Folder berhasil dibuka di File Explorer.",
      path: target.path,
    };
  } catch (error) {
    return {
      opened: false,
      message: getErrorMessage(error, "Gagal membuka folder di File Explorer."),
      path: target.path,
    };
  }
}

export type { CleanResult };
