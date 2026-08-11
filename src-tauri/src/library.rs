//! Library grid + PDF import: pick a PDF, copy it into the app-data library
//! folder, extract its content via the sidecar, and persist metadata + the
//! extracted content in the `library` table.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::sidecar;
use crate::AppDb;

#[derive(Serialize)]
pub struct LibraryEntry {
    id: i64,
    filename: String,
    title: String,
    added_at: String,
    page_count: Option<i64>,
    character_set: String,
}

#[derive(Serialize)]
pub struct DocumentText {
    title: String,
    character_set: String,
    page_count: Option<i64>,
    extracted_text: String,
    /// Per-page interleaved text/image blocks for the reflow view — opaque
    /// JSON parsed straight from what's stored (see sidecar::ExtractResult).
    content_blocks: serde_json::Value,
}

fn library_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir")
        .join("library")
}

fn row_to_entry(row: &rusqlite::Row) -> rusqlite::Result<LibraryEntry> {
    Ok(LibraryEntry {
        id: row.get(0)?,
        filename: row.get(1)?,
        title: row.get(2)?,
        added_at: row.get(3)?,
        page_count: row.get(4)?,
        character_set: row.get(5)?,
    })
}

const ENTRY_COLUMNS: &str = "id, filename, title, added_at, page_count, character_set";

#[tauri::command]
pub async fn import_pdf(app: AppHandle, db: State<'_, AppDb>) -> Result<LibraryEntry, String> {
    let picked = {
        let app = app.clone();
        tokio::task::spawn_blocking(move || {
            app.dialog().file().add_filter("PDF", &["pdf"]).blocking_pick_file()
        })
        .await
        .map_err(|e| e.to_string())?
    };

    let Some(file_path) = picked else {
        return Err("no file selected".into());
    };
    let source_path = file_path.into_path().map_err(|e| e.to_string())?;

    let title = source_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".to_string());

    let dir = library_dir(&app);
    // The sidecar HTTP call below is awaited with no DB connection/guard
    // alive across it — rusqlite::Connection isn't Send, and Tauri commands
    // require their whole future to be Send, so nothing that touches `conn`
    // can straddle an `.await`.
    let (stored_filename, page_count, text, blocks) = copy_and_extract(&dir, &source_path).await?;

    let conn = db.0.lock().unwrap();
    insert_entry(&conn, &stored_filename, &title, page_count, &text, &blocks)
}

/// Copies `source_path` into `library_dir` and extracts its content via the
/// sidecar — the part of `import_pdf` that doesn't need a real window, so
/// it's testable on its own.
async fn copy_and_extract(
    library_dir: &Path,
    source_path: &Path,
) -> Result<(String, Option<i64>, String, serde_json::Value), String> {
    std::fs::create_dir_all(library_dir).map_err(|e| e.to_string())?;
    let stored_filename = format!("{}.pdf", uuid::Uuid::new_v4());
    let stored_path = library_dir.join(&stored_filename);
    std::fs::copy(source_path, &stored_path).map_err(|e| e.to_string())?;

    match sidecar::extract_content(&stored_path).await {
        Ok(result) => Ok((stored_filename, Some(result.page_count), result.text, result.blocks)),
        Err(err) => {
            let _ = std::fs::remove_file(&stored_path);
            Err(err)
        }
    }
}

fn insert_entry(
    conn: &Connection,
    filename: &str,
    title: &str,
    page_count: Option<i64>,
    extracted_text: &str,
    content_blocks: &serde_json::Value,
) -> Result<LibraryEntry, String> {
    conn.execute(
        "INSERT INTO library (filename, title, page_count, extracted_text, content_blocks) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            filename,
            title,
            page_count,
            extracted_text,
            content_blocks.to_string()
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();

    conn.query_row(
        &format!("SELECT {ENTRY_COLUMNS} FROM library WHERE id = ?1"),
        [id],
        row_to_entry,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_library(db: State<'_, AppDb>) -> Result<Vec<LibraryEntry>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!("SELECT {ENTRY_COLUMNS} FROM library ORDER BY added_at DESC"))
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_entry).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

type DocumentRow = (String, String, Option<i64>, String, Option<String>, String);

fn fetch_document_row(conn: &Connection, id: i64) -> Result<DocumentRow, String> {
    conn.query_row(
        "SELECT title, character_set, page_count, extracted_text, content_blocks, filename FROM library WHERE id = ?1",
        [id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        },
    )
    .map_err(|e| e.to_string())
}

fn persist_backfill(
    conn: &Connection,
    id: i64,
    text: &str,
    blocks: &serde_json::Value,
    page_count: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE library SET extracted_text = ?1, content_blocks = ?2, page_count = ?3 WHERE id = ?4",
        rusqlite::params![text, blocks.to_string(), page_count, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_document(id: i64, app: AppHandle, db: State<'_, AppDb>) -> Result<DocumentText, String> {
    let (title, character_set, page_count, extracted_text, blocks_text, filename) = {
        let conn = db.0.lock().unwrap();
        fetch_document_row(&conn, id)?
    };

    if let Some(blocks_str) = blocks_text {
        let content_blocks = serde_json::from_str(&blocks_str).unwrap_or(serde_json::Value::Null);
        return Ok(DocumentText { title, character_set, page_count, extracted_text, content_blocks });
    }

    // Imported before content_blocks existed (Phase 1) — backfill once by
    // re-extracting from the still-stored PDF, then persist so this doesn't
    // repeat on every open.
    let path = library_dir(&app).join(&filename);
    let result = sidecar::extract_content(&path).await?;
    {
        let conn = db.0.lock().unwrap();
        persist_backfill(&conn, id, &result.text, &result.blocks, result.page_count)?;
    }

    Ok(DocumentText {
        title,
        character_set,
        page_count: Some(result.page_count),
        extracted_text: result.text,
        content_blocks: result.blocks,
    })
}

fn delete_row_and_get_filename(conn: &Connection, id: i64) -> Result<String, String> {
    let filename: String = conn
        .query_row("SELECT filename FROM library WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM library WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(filename)
}

#[tauri::command]
pub fn delete_document(id: i64, app: AppHandle, db: State<'_, AppDb>) -> Result<(), String> {
    let filename = {
        let conn = db.0.lock().unwrap();
        delete_row_and_get_filename(&conn, id)?
    };
    let _ = std::fs::remove_file(library_dir(&app).join(filename));
    Ok(())
}

#[tauri::command]
pub async fn get_page_image(
    id: i64,
    page_number: i64,
    app: AppHandle,
    db: State<'_, AppDb>,
) -> Result<serde_json::Value, String> {
    let filename = {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT filename FROM library WHERE id = ?1", [id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
    };
    let path = library_dir(&app).join(filename);
    sidecar::render_page(&path, page_number, 150).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // Exercises the real sidecar over HTTP, same as production — requires
    // `sidecar/main.py` already running on 127.0.0.1:7420 (see PLAN.md §5.6).
    #[tokio::test]
    async fn import_extracts_text_and_round_trips_through_sqlite() {
        let tmp = std::env::temp_dir().join(format!("mm-test-{}", uuid::Uuid::new_v4()));
        let pdf_path = tmp.join("source.pdf");
        std::fs::create_dir_all(&tmp).unwrap();

        let doc = pymupdf_test_pdf("你好，世界！中文測試");
        std::fs::write(&pdf_path, doc).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/schema.sql")).unwrap();

        let (filename, page_count, text, blocks) = copy_and_extract(&tmp.join("library"), &pdf_path)
            .await
            .expect("import should succeed against a text-layer PDF");
        let entry = insert_entry(&conn, &filename, "Test Doc", page_count, &text, &blocks).unwrap();

        assert_eq!(entry.title, "Test Doc");
        assert_eq!(entry.page_count, Some(1));
        assert!(blocks.is_array());

        let fetched = conn
            .query_row(
                "SELECT extracted_text FROM library WHERE id = ?1",
                [entry.id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        assert!(fetched.contains("你好"));

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[tokio::test]
    async fn get_document_backfills_content_blocks_for_legacy_rows() {
        let tmp = std::env::temp_dir().join(format!("mm-test-{}", uuid::Uuid::new_v4()));
        let pdf_path = tmp.join("source.pdf");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(&pdf_path, pymupdf_test_pdf("你好，世界！")).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/schema.sql")).unwrap();

        let library_dir = tmp.join("library");
        let (filename, page_count, text, _blocks) = copy_and_extract(&library_dir, &pdf_path).await.unwrap();
        // Simulate a Phase-1-era row: text present, content_blocks never populated.
        let entry = insert_entry(&conn, &filename, "Legacy Doc", page_count, &text, &serde_json::Value::Null).unwrap();
        conn.execute("UPDATE library SET content_blocks = NULL WHERE id = ?1", [entry.id])
            .unwrap();

        let (title, character_set, _page_count, extracted_text, blocks_text, filename) =
            fetch_document_row(&conn, entry.id).unwrap();
        assert!(blocks_text.is_none(), "row should start with no content_blocks");

        let path = library_dir.join(&filename);
        let result = sidecar::extract_content(&path).await.unwrap();
        persist_backfill(&conn, entry.id, &result.text, &result.blocks, result.page_count).unwrap();

        let (_, _, _, _, blocks_after, _) = fetch_document_row(&conn, entry.id).unwrap();
        assert!(blocks_after.is_some(), "backfill should have populated content_blocks");
        assert!(serde_json::from_str::<serde_json::Value>(&blocks_after.unwrap()).unwrap().is_array());
        assert_eq!(title, "Legacy Doc");
        assert_eq!(character_set, "simplified");
        assert!(extracted_text.contains("你好"));

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn delete_document_removes_row_and_file() {
        let tmp = std::env::temp_dir().join(format!("mm-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let pdf_path = tmp.join("stored.pdf");
        std::fs::write(&pdf_path, b"fake pdf bytes").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/schema.sql")).unwrap();
        let entry = insert_entry(&conn, "stored.pdf", "To Delete", Some(1), "text", &serde_json::json!([])).unwrap();

        let filename = delete_row_and_get_filename(&conn, entry.id).unwrap();
        std::fs::remove_file(tmp.join(&filename)).unwrap();

        let remaining: i64 = conn.query_row("SELECT COUNT(*) FROM library", [], |r| r.get(0)).unwrap();
        assert_eq!(remaining, 0);
        assert!(!pdf_path.exists());

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// Builds a minimal single-page PDF with real CJK text via the sidecar's
    /// own pymupdf-equivalent — shells out to Python since the Rust side has
    /// no PDF-writing capability of its own (it only ever reads PDFs via the
    /// sidecar).
    fn pymupdf_test_pdf(text: &str) -> Vec<u8> {
        let out = std::env::temp_dir().join(format!("mm-test-src-{}.pdf", uuid::Uuid::new_v4()));
        let script = format!(
            "import pymupdf; d = pymupdf.open(); p = d.new_page(); \
             p.insert_font(fontname='china-s'); p.insert_text((72, 72), '{text}', fontname='china-s'); \
             d.save('{out}')",
            out = out.display()
        );
        let status = std::process::Command::new(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar/.venv/bin/python"),
        )
        .arg("-c")
        .arg(&script)
        .status()
        .expect("failed to run python to build test fixture PDF");
        assert!(status.success());
        let bytes = std::fs::read(&out).unwrap();
        std::fs::remove_file(&out).ok();
        bytes
    }
}
