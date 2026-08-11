//! BYOK AI features (PLAN.md phase 5): a thin provider abstraction over
//! Anthropic/OpenAI, OS-keychain key storage, document-scoped chat, "use in
//! a sentence", and a segmentation-fallback for spans jieba+CEDICT couldn't
//! resolve. Nothing here ever runs unless the user turns AI on and supplies
//! their own key — `require_enabled` gates every command before any key
//! lookup or network call happens.

use keyring::Entry;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppDb;

const KEYCHAIN_SERVICE: &str = "com.midgetmandarin.app";
const SETTINGS_KEY: &str = "ai_settings";
const MAX_CONTEXT_CHARS: usize = 8000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiSettings {
    pub enabled: bool,
    pub provider: String, // "anthropic" | "openai"
    pub model: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: "anthropic".into(),
            model: "claude-haiku-4-5-20251001".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

fn read_settings(conn: &Connection) -> AiSettings {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [SETTINGS_KEY], |row| {
        row.get::<_, String>(0)
    })
    .ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default()
}

fn write_settings(conn: &Connection, settings: &AiSettings) -> Result<(), String> {
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![SETTINGS_KEY, json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn require_enabled(conn: &Connection) -> Result<AiSettings, String> {
    let settings = read_settings(conn);
    if !settings.enabled {
        return Err("AI features are turned off — enable them in AI Settings.".into());
    }
    Ok(settings)
}

fn truncate_context(text: &str) -> String {
    if text.chars().count() <= MAX_CONTEXT_CHARS {
        text.to_string()
    } else {
        let truncated: String = text.chars().take(MAX_CONTEXT_CHARS).collect();
        format!("{truncated}\n\n[...document truncated to fit the model's context window...]")
    }
}

#[tauri::command]
pub fn get_ai_settings(db: State<'_, AppDb>) -> Result<AiSettings, String> {
    let conn = db.0.lock().unwrap();
    Ok(read_settings(&conn))
}

#[tauri::command]
pub fn set_ai_settings(settings: AiSettings, db: State<'_, AppDb>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    write_settings(&conn, &settings)
}

fn keychain_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_api_key(provider: String, key: String) -> Result<(), String> {
    keychain_entry(&provider)?.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_api_key(provider: String) -> Result<bool, String> {
    match keychain_entry(&provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    match keychain_entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn get_api_key(provider: &str) -> Result<String, String> {
    keychain_entry(provider)?
        .get_password()
        .map_err(|_| "No API key saved for this provider — add one in AI Settings.".to_string())
}

#[async_trait::async_trait]
trait Provider {
    async fn chat(&self, api_key: &str, model: &str, system: &str, messages: &[ChatMessage]) -> Result<String, String>;
}

struct AnthropicProvider;

#[async_trait::async_trait]
impl Provider for AnthropicProvider {
    async fn chat(&self, api_key: &str, model: &str, system: &str, messages: &[ChatMessage]) -> Result<String, String> {
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 1024,
            "system": system,
            "messages": messages.iter().map(|m| serde_json::json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
        });
        let resp = reqwest::Client::new()
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Anthropic request failed: {e}"))?;

        let status = resp.status();
        let value: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            let msg = value["error"]["message"].as_str().unwrap_or("request failed");
            return Err(format!("Anthropic error: {msg}"));
        }
        value["content"][0]["text"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "unexpected Anthropic response shape".to_string())
    }
}

struct OpenAiProvider;

#[async_trait::async_trait]
impl Provider for OpenAiProvider {
    async fn chat(&self, api_key: &str, model: &str, system: &str, messages: &[ChatMessage]) -> Result<String, String> {
        let mut all_messages = vec![serde_json::json!({"role": "system", "content": system})];
        all_messages.extend(messages.iter().map(|m| serde_json::json!({"role": m.role, "content": m.content})));
        let body = serde_json::json!({ "model": model, "messages": all_messages });

        let resp = reqwest::Client::new()
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenAI request failed: {e}"))?;

        let status = resp.status();
        let value: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            let msg = value["error"]["message"].as_str().unwrap_or("request failed");
            return Err(format!("OpenAI error: {msg}"));
        }
        value["choices"][0]["message"]["content"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "unexpected OpenAI response shape".to_string())
    }
}

fn provider_for(name: &str) -> Result<Box<dyn Provider + Send + Sync>, String> {
    match name {
        "anthropic" => Ok(Box::new(AnthropicProvider)),
        "openai" => Ok(Box::new(OpenAiProvider)),
        other => Err(format!("unknown AI provider: {other}")),
    }
}

#[tauri::command]
pub async fn ai_chat(doc_id: Option<i64>, messages: Vec<ChatMessage>, db: State<'_, AppDb>) -> Result<String, String> {
    let (settings, doc_text) = {
        let conn = db.0.lock().unwrap();
        let settings = require_enabled(&conn)?;
        let doc_text = doc_id.and_then(|id| {
            conn.query_row("SELECT extracted_text FROM library WHERE id = ?1", [id], |row| row.get::<_, String>(0))
                .ok()
        });
        (settings, doc_text)
    };

    let api_key = get_api_key(&settings.provider)?;
    let provider = provider_for(&settings.provider)?;

    let system = match doc_text {
        Some(text) => format!(
            "You are a helpful assistant for a Mandarin Chinese reading app. The user is reading \
             the document below. Answer questions about it, and help explain vocabulary, grammar, \
             and meaning. Keep answers concise.\n\n--- Document ---\n{}",
            truncate_context(&text)
        ),
        None => "You are a helpful assistant for a Mandarin Chinese reading app. Keep answers concise.".to_string(),
    };

    provider.chat(&api_key, &settings.model, &system, &messages).await
}

#[tauri::command]
pub async fn ai_use_in_sentence(word: String, db: State<'_, AppDb>) -> Result<String, String> {
    let settings = {
        let conn = db.0.lock().unwrap();
        require_enabled(&conn)?
    };
    let api_key = get_api_key(&settings.provider)?;
    let provider = provider_for(&settings.provider)?;

    let system = "You are a helpful assistant for a Mandarin Chinese learner. Given a word, write \
                  one natural example sentence in Chinese using it, then give an English translation \
                  on the next line. Keep it short and beginner-friendly."
        .to_string();
    let messages = vec![ChatMessage { role: "user".into(), content: format!("Word: {word}") }];

    provider.chat(&api_key, &settings.model, &system, &messages).await
}

/// Segmentation fallback: triggered from the frontend specifically when
/// jieba+CEDICT couldn't resolve a clicked span (no dictionary entry found)
/// — a real, detectable proxy for "low confidence" since jieba itself
/// exposes no confidence score. Common on poetry/classical Chinese/names.
#[tauri::command]
pub async fn ai_explain_span(span: String, context: String, db: State<'_, AppDb>) -> Result<String, String> {
    let settings = {
        let conn = db.0.lock().unwrap();
        require_enabled(&conn)?
    };
    let api_key = get_api_key(&settings.provider)?;
    let provider = provider_for(&settings.provider)?;

    let system = "You are a Mandarin Chinese dictionary assistant. The user's word segmenter and \
                  dictionary couldn't resolve a span of text, which sometimes happens with classical \
                  Chinese, poetry, or names. Given the span and its surrounding sentence, identify \
                  what it most likely means (breaking it into the correct word(s) if the segmentation \
                  was wrong), and give pinyin and a brief definition/explanation."
        .to_string();
    let messages = vec![ChatMessage {
        role: "user".into(),
        content: format!("Span: {span}\nSentence: {context}"),
    }];

    provider.chat(&api_key, &settings.model, &system, &messages).await
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
    fn ai_settings_round_trip() {
        let conn = test_db();
        assert!(!read_settings(&conn).enabled, "AI should default to off");

        let custom = AiSettings { enabled: true, provider: "openai".into(), model: "gpt-4o-mini".into() };
        write_settings(&conn, &custom).unwrap();
        let read = read_settings(&conn);
        assert!(read.enabled);
        assert_eq!(read.provider, "openai");
        assert_eq!(read.model, "gpt-4o-mini");
    }

    #[test]
    fn require_enabled_blocks_when_off_by_default() {
        let conn = test_db();
        let err = require_enabled(&conn).unwrap_err();
        assert!(err.contains("turned off"));
    }

    #[test]
    fn require_enabled_passes_through_settings_when_on() {
        let conn = test_db();
        write_settings(&conn, &AiSettings { enabled: true, provider: "anthropic".into(), model: "m".into() }).unwrap();
        let settings = require_enabled(&conn).unwrap();
        assert_eq!(settings.provider, "anthropic");
    }

    #[test]
    fn truncate_context_leaves_short_text_untouched() {
        let text = "你好世界";
        assert_eq!(truncate_context(text), text);
    }

    #[test]
    fn truncate_context_truncates_long_text() {
        let text = "字".repeat(MAX_CONTEXT_CHARS + 500);
        let result = truncate_context(&text);
        assert!(result.contains("truncated"));
        assert!(result.chars().count() < text.chars().count());
    }

    #[test]
    fn provider_for_rejects_unknown_names() {
        assert!(provider_for("anthropic").is_ok());
        assert!(provider_for("openai").is_ok());
        assert!(provider_for("not-a-real-provider").is_err());
    }
}
