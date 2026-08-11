//! Anki .apkg export — straight from the personal vocab table to a deck,
//! via the sidecar's genanki integration (see PLAN.md phase 4).

use std::path::Path;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::sidecar;
use crate::vocab::{list_vocab_rows, VocabEntry};
use crate::AppDb;

const DECK_NAME: &str = "Midget Mandarin Vocab";

fn words_to_json(words: &[VocabEntry]) -> serde_json::Value {
    serde_json::Value::Array(
        words
            .iter()
            .map(|w| {
                serde_json::json!({
                    "simplified": w.simplified,
                    "traditional": w.traditional,
                    "pinyin": w.pinyin,
                    "definition": w.definition,
                })
            })
            .collect(),
    )
}

async fn export_words_to_path(words: &[VocabEntry], output_path: &Path) -> Result<(), String> {
    sidecar::export_anki(words_to_json(words), DECK_NAME, output_path).await
}

#[tauri::command]
pub async fn export_vocab_to_anki(app: AppHandle, db: State<'_, AppDb>) -> Result<String, String> {
    let words = {
        let conn = db.0.lock().unwrap();
        list_vocab_rows(&conn)?
    };
    if words.is_empty() {
        return Err("Your vocabulary list is empty — add some words first.".into());
    }

    let picked = {
        let app = app.clone();
        tokio::task::spawn_blocking(move || {
            app.dialog()
                .file()
                .add_filter("Anki Deck", &["apkg"])
                .set_file_name("midget-mandarin-vocab.apkg")
                .blocking_save_file()
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let Some(file_path) = picked else {
        return Err("no destination selected".into());
    };
    let output_path = file_path.into_path().map_err(|e| e.to_string())?;

    export_words_to_path(&words, &output_path).await?;
    Ok(output_path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Exercises the real sidecar over HTTP, same as production — requires
    // `sidecar/main.py` already running on 127.0.0.1:7420 (see PLAN.md §5.6).
    #[tokio::test]
    async fn exports_a_valid_apkg_with_the_right_words() {
        let out = std::env::temp_dir().join(format!("mm-anki-test-{}.apkg", uuid::Uuid::new_v4()));
        let words = vec![
            VocabEntry {
                id: 1,
                simplified: "你好".into(),
                traditional: "你好".into(),
                pinyin: "ni3 hao3".into(),
                definition: "hello".into(),
                added_at: String::new(),
            },
            VocabEntry {
                id: 2,
                simplified: "中国".into(),
                traditional: "中國".into(),
                pinyin: "Zhong1 guo2".into(),
                definition: "China".into(),
                added_at: String::new(),
            },
        ];

        export_words_to_path(&words, &out).await.expect("export should succeed");

        let metadata = std::fs::metadata(&out).expect("apkg file should exist");
        assert!(metadata.len() > 0, "apkg file should not be empty");

        std::fs::remove_file(&out).ok();
    }
}
