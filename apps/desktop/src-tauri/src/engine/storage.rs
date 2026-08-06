//! Per-app chat history storage — SQLite via sqlx (ADR-009).
//!
//! Each app has its own DB at `~/deskspawn/apps/<id>/.deskspawn/chat.db`
//! managed by Rust (never the frontend). Messages are stored as a JSON blob per
//! app for simplicity; the DB file lives next to checkpoints so an app
//! directory is fully self-contained.

use crate::engine::workspace;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

/// Open (create if missing) the chat DB for an app.
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
    // Init schema (idempotent).
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
    Ok(pool)
}

/// Append a single message.
pub async fn append_message(
    pool: &SqlitePool,
    app_id: &str,
    role: &str,
    content: &str,
) -> Result<i64, String> {
    let res = sqlx::query(
        "INSERT INTO chat_messages (app_id, role, content) VALUES (?, ?, ?)",
    )
    .bind(app_id)
    .bind(role)
    .bind(content)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to append message: {}", e))?;
    Ok(res.last_insert_rowid())
}

/// Load all messages for an app (oldest first).
pub async fn load_messages(
    pool: &SqlitePool,
    app_id: &str,
) -> Result<Vec<(i64, String, String, String)>, String> {
    let rows = sqlx::query_as::<_, (i64, String, String, String)>(
        "SELECT id, role, content, created_at FROM chat_messages
         WHERE app_id = ? ORDER BY id ASC",
    )
    .bind(app_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load messages: {}", e))?;
    Ok(rows)
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

    #[tokio::test]
    async fn chat_db_roundtrip() {
        let _guard = test_env_lock();
        let tmp = std::env::temp_dir().join(format!("deskspawn-chat-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var("DESKSPAWN_ROOT", &tmp);

        let pool = open_chat_db("app-test").await.unwrap();
        append_message(&pool, "app-test", "user", "hello").await.unwrap();
        append_message(&pool, "app-test", "assistant", "hi there").await.unwrap();

        let msgs = load_messages(&pool, "app-test").await.unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].1, "user");
        assert_eq!(msgs[0].2, "hello");
        assert_eq!(msgs[1].1, "assistant");
        assert_eq!(msgs[1].2, "hi there");

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
    async fn chat_db_creates_file_and_dir() {
        let _guard = test_env_lock();
        let tmp = std::env::temp_dir().join(format!("deskspawn-chat-test2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var("DESKSPAWN_ROOT", &tmp);

        let pool = open_chat_db("app-x").await.unwrap();
        close(pool).await;

        let db_path = workspace::app_chat_db_path("app-x").unwrap();
        assert!(db_path.exists(), "chat.db must exist on disk");

        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
