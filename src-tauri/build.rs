use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../src/scanner.ts");
    println!("cargo:rerun-if-changed=../src/scan-analysis.ts");
    println!("cargo:rerun-if-changed=../scripts/export-targets.ts");

    let output = Command::new("bun")
        .args(["run", "../scripts/export-targets.ts"])
        .output()
        .expect("failed to run Bun target exporter");

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        panic!("target export failed: {stderr}");
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("missing OUT_DIR"));
    fs::write(out_dir.join("targets.json"), output.stdout)
        .expect("failed to write generated target catalog");

    tauri_build::build()
}
