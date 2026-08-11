//! Read-only access to the CC-CEDICT dictionary built by
//! data/cedict/build_db.py. That script is standalone and rerunnable but not
//! run automatically, so the database may not exist yet — lookups degrade to
//! a clear error rather than failing app startup.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

pub struct CedictDb(pub Mutex<Option<Connection>>);

fn cedict_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/cedict/cedict.sqlite")
}

pub fn open() -> Option<Connection> {
    let path = cedict_path();
    if !path.exists() {
        return None;
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

#[derive(Serialize, Clone)]
pub struct DictEntry {
    pub traditional: String,
    pub simplified: String,
    pub pinyin: String,
    pub definition: String,
}

/// Matches on either script, since a word clicked in a traditional-set
/// document should still resolve against the same CC-CEDICT entry.
pub fn lookup(conn: &Connection, word: &str) -> rusqlite::Result<Vec<DictEntry>> {
    let mut stmt = conn.prepare(
        "SELECT traditional, simplified, pinyin, definition FROM dictionary \
         WHERE simplified = ?1 OR traditional = ?1",
    )?;
    let rows = stmt.query_map([word], |row| {
        Ok(DictEntry {
            traditional: row.get(0)?,
            simplified: row.get(1)?,
            pinyin: row.get(2)?,
            definition: row.get(3)?,
        })
    })?;
    rows.collect()
}
