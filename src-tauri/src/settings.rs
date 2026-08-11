//! App-wide reading preferences (font family, size, line spacing) —
//! persisted as a single JSON blob in the generic `settings` key/value
//! table, since these apply across every document rather than per-doc.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppDb;

#[derive(Serialize, Deserialize, Clone)]
pub struct ReadingSettings {
    pub font_family: String, // "sans" | "serif"
    pub font_size: f64,      // px
    pub line_height: f64,    // unitless multiplier
}

impl Default for ReadingSettings {
    fn default() -> Self {
        Self {
            font_family: "sans".into(),
            font_size: 18.0,
            line_height: 1.8,
        }
    }
}

const SETTINGS_KEY: &str = "reading_settings";

fn read_settings(conn: &Connection) -> ReadingSettings {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [SETTINGS_KEY], |row| {
        row.get::<_, String>(0)
    })
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default()
}

fn write_settings(conn: &Connection, settings: &ReadingSettings) -> Result<(), String> {
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![SETTINGS_KEY, json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_reading_settings(db: State<'_, AppDb>) -> Result<ReadingSettings, String> {
    let conn = db.0.lock().unwrap();
    Ok(read_settings(&conn))
}

#[tauri::command]
pub fn set_reading_settings(settings: ReadingSettings, db: State<'_, AppDb>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    write_settings(&conn, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/schema.sql")).unwrap();
        conn
    }

    #[test]
    fn defaults_when_unset() {
        let conn = test_db();
        let s = read_settings(&conn);
        assert_eq!(s.font_family, "sans");
        assert_eq!(s.font_size, 18.0);
    }

    #[test]
    fn round_trips_through_write_and_read() {
        let conn = test_db();
        let custom = ReadingSettings {
            font_family: "serif".into(),
            font_size: 22.0,
            line_height: 2.0,
        };
        write_settings(&conn, &custom).unwrap();
        let read = read_settings(&conn);
        assert_eq!(read.font_family, "serif");
        assert_eq!(read.font_size, 22.0);
        assert_eq!(read.line_height, 2.0);
    }

    #[test]
    fn write_is_idempotent_upsert() {
        let conn = test_db();
        write_settings(
            &conn,
            &ReadingSettings { font_family: "sans".into(), font_size: 16.0, line_height: 1.5 },
        )
        .unwrap();
        write_settings(
            &conn,
            &ReadingSettings { font_family: "serif".into(), font_size: 20.0, line_height: 1.9 },
        )
        .unwrap();

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1, "writing twice should update the same row, not insert a second one");
        assert_eq!(read_settings(&conn).font_family, "serif");
    }
}
