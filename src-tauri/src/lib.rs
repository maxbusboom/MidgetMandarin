mod db;
mod sidecar;

use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

pub struct AppDb(pub Mutex<Connection>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn sidecar_health() -> Result<serde_json::Value, String> {
    sidecar::health_check().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(sidecar::SidecarProcess(Mutex::new(None)))
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let conn = db::open(&app_data_dir)?;
            app.manage(AppDb(Mutex::new(conn)));

            let child = sidecar::spawn().expect("failed to spawn NLP sidecar");
            let state = app.state::<sidecar::SidecarProcess>();
            *state.0.lock().unwrap() = Some(child);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, sidecar_health])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<sidecar::SidecarProcess>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
