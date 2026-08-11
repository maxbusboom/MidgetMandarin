//! App-data SQLite (library/vocab/settings). See migrations/schema.sql.

use std::path::Path;

use rusqlite::Connection;

const SCHEMA: &str = include_str!("../migrations/schema.sql");

pub fn open(app_data_dir: &Path) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(app_data_dir).expect("failed to create app data dir");
    let conn = Connection::open(app_data_dir.join("midget-mandarin.sqlite"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(SCHEMA)?;
    // CREATE TABLE IF NOT EXISTS above only lays down the schema for a fresh
    // db; existing dev databases from before this column existed need it
    // added explicitly.
    ensure_column(&conn, "library", "extracted_text", "TEXT")?;
    ensure_column(&conn, "library", "content_blocks", "TEXT")?;
    Ok(conn)
}

fn ensure_column(conn: &Connection, table: &str, column: &str, sql_type: &str) -> rusqlite::Result<()> {
    let exists: bool = conn
        .prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"))?
        .exists([column])?;
    if !exists {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))?;
    }
    Ok(())
}
