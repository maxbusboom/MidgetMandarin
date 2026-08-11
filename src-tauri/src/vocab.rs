//! Word lookups (against CC-CEDICT) and the personal vocab list built from
//! them — click-word popup + scrollable vocab panel per PLAN.md phase 3.

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::cedict::{self, CedictDb};
use crate::AppDb;

#[derive(Serialize)]
pub struct WordResult {
    pub traditional: String,
    pub simplified: String,
    pub pinyin: String,
    pub definition: String,
    /// Set when this exact headword is already in the user's vocab, so the
    /// popup can offer "remove" instead of "add".
    pub vocab_id: Option<i64>,
}

#[derive(Serialize)]
pub struct VocabEntry {
    pub id: i64,
    pub simplified: String,
    pub traditional: String,
    pub pinyin: String,
    pub definition: String,
    pub added_at: String,
}

fn row_to_vocab_entry(row: &rusqlite::Row) -> rusqlite::Result<VocabEntry> {
    Ok(VocabEntry {
        id: row.get(0)?,
        simplified: row.get(1)?,
        traditional: row.get(2)?,
        pinyin: row.get(3)?,
        definition: row.get(4)?,
        added_at: row.get(5)?,
    })
}

const VOCAB_COLUMNS: &str = "id, simplified, traditional, pinyin, definition, added_at";

fn lookup_word_rows(
    cedict_conn: &Connection,
    app_conn: &Connection,
    word: &str,
) -> Result<Vec<WordResult>, String> {
    let word = word.trim();
    if word.is_empty() {
        return Ok(vec![]);
    }

    let entries = cedict::lookup(cedict_conn, word).map_err(|e| e.to_string())?;

    let mut stmt = app_conn
        .prepare("SELECT id FROM vocab WHERE simplified = ?1")
        .map_err(|e| e.to_string())?;

    entries
        .into_iter()
        .map(|e| {
            let vocab_id: Option<i64> = stmt.query_row([&e.simplified], |row| row.get(0)).ok();
            Ok(WordResult {
                traditional: e.traditional,
                simplified: e.simplified,
                pinyin: e.pinyin,
                definition: e.definition,
                vocab_id,
            })
        })
        .collect()
}

fn add_vocab_row(
    conn: &Connection,
    simplified: &str,
    traditional: &str,
    pinyin: &str,
    definition: &str,
    source_doc_id: Option<i64>,
) -> Result<VocabEntry, String> {
    conn.execute(
        "INSERT OR IGNORE INTO vocab (simplified, traditional, pinyin, definition, source_doc_id) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![simplified, traditional, pinyin, definition, source_doc_id],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        &format!("SELECT {VOCAB_COLUMNS} FROM vocab WHERE simplified = ?1 AND traditional = ?2"),
        rusqlite::params![simplified, traditional],
        row_to_vocab_entry,
    )
    .map_err(|e| e.to_string())
}

fn remove_vocab_row(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM vocab WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn list_vocab_rows(conn: &Connection) -> Result<Vec<VocabEntry>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT {VOCAB_COLUMNS} FROM vocab ORDER BY added_at DESC"))
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_vocab_entry).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lookup_word(
    word: String,
    cedict: State<'_, CedictDb>,
    db: State<'_, AppDb>,
) -> Result<Vec<WordResult>, String> {
    let cedict_conn = cedict.0.lock().unwrap();
    let Some(conn) = cedict_conn.as_ref() else {
        return Err(
            "CC-CEDICT database not found — run `python data/cedict/build_db.py` first (see PLAN.md)."
                .into(),
        );
    };
    let app_conn = db.0.lock().unwrap();
    lookup_word_rows(conn, &app_conn, &word)
}

#[tauri::command]
pub fn add_vocab(
    simplified: String,
    traditional: String,
    pinyin: String,
    definition: String,
    source_doc_id: Option<i64>,
    db: State<'_, AppDb>,
) -> Result<VocabEntry, String> {
    let conn = db.0.lock().unwrap();
    add_vocab_row(&conn, &simplified, &traditional, &pinyin, &definition, source_doc_id)
}

#[tauri::command]
pub fn remove_vocab(id: i64, db: State<'_, AppDb>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    remove_vocab_row(&conn, id)
}

#[tauri::command]
pub fn list_vocab(db: State<'_, AppDb>) -> Result<Vec<VocabEntry>, String> {
    let conn = db.0.lock().unwrap();
    list_vocab_rows(&conn)
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
    fn lookup_finds_known_word_and_flags_vocab_membership() {
        let cedict_conn =
            cedict::open().expect("data/cedict/cedict.sqlite must exist — run data/cedict/build_db.py");
        let app_conn = test_db();

        let results = lookup_word_rows(&cedict_conn, &app_conn, "你好").unwrap();
        assert!(!results.is_empty());
        assert!(results.iter().all(|r| r.vocab_id.is_none()));

        let entry = &results[0];
        add_vocab_row(&app_conn, &entry.simplified, &entry.traditional, &entry.pinyin, &entry.definition, None).unwrap();

        let results_after = lookup_word_rows(&cedict_conn, &app_conn, "你好").unwrap();
        assert!(results_after.iter().any(|r| r.vocab_id.is_some()));
    }

    #[test]
    fn lookup_matches_either_script() {
        let cedict_conn =
            cedict::open().expect("data/cedict/cedict.sqlite must exist — run data/cedict/build_db.py");
        let app_conn = test_db();

        let via_simplified = lookup_word_rows(&cedict_conn, &app_conn, "中国").unwrap();
        let via_traditional = lookup_word_rows(&cedict_conn, &app_conn, "中國").unwrap();
        assert!(!via_simplified.is_empty());
        assert!(!via_traditional.is_empty());
    }

    #[test]
    fn add_vocab_is_idempotent_and_remove_works() {
        let conn = test_db();

        let first = add_vocab_row(&conn, "你好", "你好", "ni3 hao3", "hello", None).unwrap();
        let second = add_vocab_row(&conn, "你好", "你好", "ni3 hao3", "hello", None).unwrap();
        assert_eq!(first.id, second.id, "adding the same word twice should not create a duplicate row");

        assert_eq!(list_vocab_rows(&conn).unwrap().len(), 1);

        remove_vocab_row(&conn, first.id).unwrap();
        assert!(list_vocab_rows(&conn).unwrap().is_empty());
    }
}
