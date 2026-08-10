//! App-data SQLite (library/vocab/settings). See migrations/schema.sql.

use std::path::Path;

use rusqlite::Connection;

const SCHEMA: &str = include_str!("../migrations/schema.sql");

pub fn open(app_data_dir: &Path) -> rusqlite::Result<Connection> {
    std::fs::create_dir_all(app_data_dir).expect("failed to create app data dir");
    let conn = Connection::open(app_data_dir.join("midget-mandarin.sqlite"))?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}
