//! Spawns and talks to the Python NLP sidecar over local HTTP.
//!
//! Dev-mode only: runs the sidecar straight out of `sidecar/.venv` relative to
//! the `src-tauri` crate. Phase 8 packaging swaps this for Tauri's bundled
//! `externalBin` sidecar mechanism so a system Python isn't required at
//! runtime — see PLAN.md phase 8.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

pub const SIDECAR_PORT: u16 = 7420;

pub struct SidecarProcess(pub Mutex<Option<Child>>);

fn sidecar_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar")
}

pub fn spawn() -> std::io::Result<Child> {
    let dir = sidecar_dir();
    let python = if cfg!(windows) {
        dir.join(".venv/Scripts/python.exe")
    } else {
        dir.join(".venv/bin/python")
    };

    Command::new(python)
        .arg("main.py")
        .current_dir(&dir)
        .env("MIDGET_MANDARIN_SIDECAR_PORT", SIDECAR_PORT.to_string())
        .spawn()
}

pub async fn health_check() -> Result<serde_json::Value, String> {
    let url = format!("http://127.0.0.1:{SIDECAR_PORT}/health");

    // The sidecar takes a moment to boot (Python interpreter + FastAPI/uvicorn
    // startup), so retry briefly instead of failing on the first attempt.
    let mut last_err = String::new();
    for _ in 0..20 {
        match reqwest::get(&url).await {
            Ok(resp) => {
                return resp
                    .json::<serde_json::Value>()
                    .await
                    .map_err(|e| e.to_string());
            }
            Err(e) => {
                last_err = e.to_string();
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
        }
    }
    Err(format!("sidecar not reachable at {url}: {last_err}"))
}
