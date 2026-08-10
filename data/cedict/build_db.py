#!/usr/bin/env python3
"""Build the CC-CEDICT SQLite dictionary used for word lookups.

Standalone and rerunnable: fetches the CC-CEDICT text dump (unless --input
points at an already-downloaded copy), parses it, and writes a fresh SQLite
file with both simplified and traditional headwords per entry so lookups can
match on whichever character set the reader has active.

CC-CEDICT is CC BY-SA 4.0 licensed (https://cc-cedict.org/wiki/) — the app
must show this attribution wherever dictionary data is displayed (see
PLAN.md phase 8).

Usage:
    python build_db.py                       # download + build data/cedict/cedict.sqlite
    python build_db.py --input dump.txt       # build from an existing local dump
    python build_db.py --output /tmp/out.sqlite
"""

import argparse
import gzip
import re
import sqlite3
import sys
import urllib.request
from pathlib import Path

CEDICT_URL = "https://www.mdbg.net/chindict/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz"

# Matches lines like: 中國 中国 [Zhong1 guo2] /China/Middle Kingdom/
ENTRY_RE = re.compile(r"^(\S+)\s+(\S+)\s+\[(.*?)\]\s+/(.*)/\s*$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS dictionary (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    traditional TEXT NOT NULL,
    simplified  TEXT NOT NULL,
    pinyin      TEXT NOT NULL,
    definition  TEXT NOT NULL,
    UNIQUE (traditional, simplified, pinyin)
);
CREATE INDEX IF NOT EXISTS idx_dictionary_simplified ON dictionary (simplified);
CREATE INDEX IF NOT EXISTS idx_dictionary_traditional ON dictionary (traditional);
"""


def fetch_dump() -> str:
    print(f"downloading {CEDICT_URL}", file=sys.stderr)
    with urllib.request.urlopen(CEDICT_URL) as resp:
        return gzip.decompress(resp.read()).decode("utf-8")


def parse_entries(text: str):
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        match = ENTRY_RE.match(line)
        if not match:
            continue
        traditional, simplified, pinyin, definitions = match.groups()
        yield traditional, simplified, pinyin, definitions.replace("/", "; ")


def build(dump_text: str, db_path: Path) -> int:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)

    rows = list(parse_entries(dump_text))
    conn.executemany(
        "INSERT OR IGNORE INTO dictionary (traditional, simplified, pinyin, definition) "
        "VALUES (?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    conn.close()
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="local CC-CEDICT dump (skip download)")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "cedict.sqlite",
        help="output SQLite path (default: data/cedict/cedict.sqlite)",
    )
    args = parser.parse_args()

    dump_text = args.input.read_text(encoding="utf-8") if args.input else fetch_dump()
    count = build(dump_text, args.output)
    print(f"wrote {count} entries to {args.output}")


if __name__ == "__main__":
    main()
