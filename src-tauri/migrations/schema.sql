-- Midget Mandarin app-data schema.
--
-- Scope: library metadata, personal vocab, and settings — owned and written
-- by the Rust core. The CC-CEDICT dictionary lives in its own read-only
-- SQLite file built by data/cedict/build_db.py, kept separate so the two
-- never have competing writers.

CREATE TABLE IF NOT EXISTS library (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    filename       TEXT NOT NULL,
    title          TEXT NOT NULL,
    added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    page_count     INTEGER,
    character_set  TEXT NOT NULL DEFAULT 'simplified' CHECK (character_set IN ('simplified', 'traditional')),
    extracted_text TEXT,
    content_blocks TEXT
);

CREATE TABLE IF NOT EXISTS vocab (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    simplified    TEXT NOT NULL,
    traditional   TEXT,
    pinyin        TEXT,
    definition    TEXT,
    source_doc_id INTEGER REFERENCES library(id) ON DELETE SET NULL,
    added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (simplified, traditional)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
