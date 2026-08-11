//! Per-app chat history storage — SQLite via sqlx (ADR-009).
//!
//! Each app has its own DB at `~/deskspawn/apps/<id>/.deskspawn/chat.db`
//! managed by Rust (never the frontend). Messages are stored as one row per
//! message; the full frontend message object (stepLogs, phaseOutputs, usage,
//! checkpointId, timestamp) is kept in a JSON `payload` column so a reload
//! restores the chat exactly as the UI rendered it (schema v2, ADR-013).
//!
//! Schema v2 adds `client_id` (frontend message id, e.g. `msg-…`) and
//! `payload` (full message JSON). Existing v1 databases are migrated in place
//! with `ALTER TABLE` + backfill so no user data is lost.
//!
//! Writes are **replace-all within a transaction**: the frontend passes the
//! complete message list and Rust deletes + re-inserts atomically. This gives
//! edit / truncate / reorder semantics identical to the web IndexedDB path and
//! avoids the append-only races that previously lost messages.

use crate::engine::workspace;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use sqlx::SqlitePool;
use std::str::FromStr;

/// One message row as exchanged with the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessageRow {
    /// Frontend message id (`msg-…`); None for legacy v1 rows (backfilled to `legacy-<id>`).
    pub client_id: Option<String>,
    pub role: String,
    pub content: String,
    /// Full frontend message object as JSON (stepLogs / phaseOutputs / usage / …).
    pub payload: Option<String>,
    /// DB timestamp; None for new rows (the DB defaults to `datetime('now')`).
    pub created_at: Option<String>,
}

/// Open (create if missing) the chat DB for an app, migrating v1 → v2 as needed.
pub async fn open_chat_db(app_id: &str) -> Result<SqlitePool, String> {
    let path = workspace::app_chat_db_path(app_id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create chat db dir: {}", e))?;
    }
    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
        .map_err(|e| format!("Invalid sqlite url: {}", e))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| format!("Failed to open chat db: {}", e))?;
    // Init schema v2 (idempotent).
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to init chat schema: {}", e))?;
    migrate_schema_v2(&pool).await?;
    Ok(pool)
}

/// Migrate a v1 database to v2: add `client_id` + `payload` columns, backfill
/// legacy rows, and create the upsert index. Idempotent — safe to run on every
/// open (PRAGMA table_info is cheap).
async fn migrate_schema_v2(pool: &SqlitePool) -> Result<(), String> {
    let cols = sqlx::query("PRAGMA table_info(chat_messages)")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to read chat schema: {}", e))?;
    let has_client_id = cols.iter().any(|c| {
        c.try_get::<String, _>("name").map(|n| n == "client_id").unwrap_or(false)
    });
    let has_payload = cols.iter().any(|c| {
        c.try_get::<String, _>("name").map(|n| n == "payload").unwrap_or(false)
    });

    if !has_client_id {
        sqlx::query("ALTER TABLE chat_messages ADD COLUMN client_id TEXT")
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to add client_id column: {}", e))?;
    }
    if !has_payload {
        sqlx::query("ALTER TABLE chat_messages ADD COLUMN payload TEXT")
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to add payload column: {}", e))?;
    }
    // Legacy rows get a stable client_id so future upserts never conflict.
    sqlx::query("UPDATE chat_messages SET client_id = 'legacy-' || id WHERE client_id IS NULL OR client_id = ''")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to backfill client_id: {}", e))?;
    // Upsert target for `INSERT … ON CONFLICT(app_id, client_id)`.
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_app_client
         ON chat_messages(app_id, client_id)",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create chat upsert index: {}", e))?;
    Ok(())
}

/// Replace-all write of an app's complete message list (atomic).
///
/// `messages` are full frontend message objects serialized as JSON payloads,
/// with `client_id` / `role` / `content` duplicated as columns for
/// compatibility and querying. Legacy rows (no payload) are preserved.
pub async fn save_messages(
    pool: &SqlitePool,
    app_id: &str,
    messages: &[ChatMessageRow],
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin chat save txn: {}", e))?;

    sqlx::query("DELETE FROM chat_messages WHERE app_id = ?")
        .bind(app_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to clear chat messages: {}", e))?;

    for m in messages {
        let client_id = m.client_id.as_deref().unwrap_or("");
        sqlx::query(
            "INSERT INTO chat_messages (app_id, client_id, role, content, payload, created_at)
             VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))",
        )
        .bind(app_id)
        .bind(client_id)
        .bind(&m.role)
        .bind(&m.content)
        .bind(&m.payload)
        .bind(&m.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert chat message: {}", e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit chat save txn: {}", e))?;
    Ok(())
}

/// Load all messages for an app (oldest first).
pub async fn load_messages(
    pool: &SqlitePool,
    app_id: &str,
) -> Result<Vec<ChatMessageRow>, String> {
    let rows = sqlx::query_as::<_, (i64, Option<String>, String, String, Option<String>, Option<String>)>(
        "SELECT id, client_id, role, content, payload, created_at FROM chat_messages
         WHERE app_id = ? ORDER BY id ASC",
    )
    .bind(app_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load messages: {}", e))?;
    Ok(rows
        .into_iter()
        .map(|(_, client_id, role, content, payload, created_at)| ChatMessageRow {
            client_id,
            role,
            content,
            payload,
            created_at,
        })
        .collect())
}

/// Delete all messages for an app (used when an app is removed).
pub async fn clear_messages(pool: &SqlitePool, app_id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM chat_messages WHERE app_id = ?")
        .bind(app_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to clear messages: {}", e))?;
    Ok(())
}

/// Close the pool (best-effort; also drops the file handle).
pub async fn close(pool: SqlitePool) {
    pool.close().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::workspace::test_env_lock;

    async fn open_test_db(name: &str) -> (SqlitePool, std::path::PathBuf) {
        let tmp = std::env::temp_dir().join(format!("deskspawn-chat-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var("DESKSPAWN_ROOT", &tmp);
        let pool = open_chat_db("app-test").await.unwrap();
        (pool, tmp)
    }

    #[tokio::test]
    async fn chat_db_roundtrip_with_payload() {
        let _guard = test_env_lock();
        let (pool, tmp) = open_test_db("roundtrip").await;

        let msgs = vec![
            ChatMessageRow {
                client_id: Some("msg-user-1".into()),
                role: "user".into(),
                content: "hello".into(),
                payload: Some(r#"{"id":"msg-user-1","role":"user","content":"hello","timestamp":1700000000000}"#.into()),
                created_at: None,
            },
            ChatMessageRow {
                client_id: Some("msg-bot-2".into()),
                role: "assistant".into(),
                content: "hi there".into(),
                payload: Some(r#"{"id":"msg-bot-2","role":"assistant","content":"hi there","stepLogs":[{"step":1,"toolName":"write_file","status":"success"}],"phaseOutputs":[{"phase":"coder","label":"coder","text":"done"}]}"#.into()),
                created_at: None,
            },
        ];
        save_messages(&pool, "app-test", &msgs).await.unwrap();

        let loaded = load_messages(&pool, "app-test").await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].client_id.as_deref(), Some("msg-user-1"));
        assert_eq!(loaded[0].payload.as_deref().unwrap().contains("timestamp"), true);
        assert_eq!(loaded[1].role, "assistant");
        assert_eq!(loaded[1].payload.as_deref().unwrap().contains("stepLogs"), true);

        // Replace-all semantics: writing a single message drops the rest.
        save_messages(
            &pool,
            "app-test",
            &[ChatMessageRow {
                client_id: Some("msg-bot-3".into()),
                role: "assistant".into(),
                content: "only".into(),
                payload: Some(r#"{"id":"msg-bot-3","role":"assistant","content":"only"}"#.into()),
                created_at: None,
            }],
        )
        .await
        .unwrap();
        let after = load_messages(&pool, "app-test").await.unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].client_id.as_deref(), Some("msg-bot-3"));

        // Isolation: other app has no messages.
        let other = load_messages(&pool, "app-other").await.unwrap();
        assert!(other.is_empty());

        clear_messages(&pool, "app-test").await.unwrap();
        assert!(load_messages(&pool, "app-test").await.unwrap().is_empty());

        close(pool).await;
        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn v1_db_migrates_to_v2_without_data_loss() {
        let _guard = test_env_lock();
        let tmp = std::env::temp_dir().join(format!("deskspawn-chat-migrate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var("DESKSPAWN_ROOT", &tmp);

        // Simulate a v1 database: old schema + one legacy row.
        let path = workspace::app_chat_db_path("app-old").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .unwrap()
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chat_messages (app_id, role, content, created_at)
             VALUES ('app-old', 'user', 'ToDoアプリを作成して', '2026-08-07 07:11:39')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool.close().await;

        // Reopen via the normal path → migration runs.
        let pool = open_chat_db("app-old").await.unwrap();
        let loaded = load_messages(&pool, "app-old").await.unwrap();
        assert_eq!(loaded.len(), 1, "legacy row must survive migration");
        assert_eq!(loaded[0].content, "ToDoアプリを作成して");
        assert_eq!(
            loaded[0].client_id.as_deref().unwrap().starts_with("legacy-"),
            true,
            "legacy rows get a backfilled client_id"
        );
        assert!(loaded[0].payload.is_none());

        // Upsert-safe: a new save keeps working alongside the legacy row path.
        save_messages(
            &pool,
            "app-old",
            &[ChatMessageRow {
                client_id: Some("msg-new-1".into()),
                role: "user".into(),
                content: "new message".into(),
                payload: Some(r#"{"id":"msg-new-1","role":"user","content":"new message"}"#.into()),
                created_at: None,
            }],
        )
        .await
        .unwrap();
        let after = load_messages(&pool, "app-old").await.unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].client_id.as_deref(), Some("msg-new-1"));

        close(pool).await;
        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn chat_db_creates_file_and_dir() {
        let _guard = test_env_lock();
        let (pool, tmp) = open_test_db("createdir").await;
        close(pool).await;

        let db_path = workspace::app_chat_db_path("app-test").unwrap();
        assert!(db_path.exists(), "chat.db must exist on disk");

        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
