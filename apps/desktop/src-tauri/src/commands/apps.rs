//! App management commands — real files on disk under `~/deskspawn/apps`.
//!
//! Desktop-only (see ADR-008). The web version keeps using IndexedDB/OPFS.
//! Registry: `~/deskspawn/apps/apps.json` (JSON array of AppMeta).

use crate::engine::workspace;
use crate::engine::security;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// App metadata stored in the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppMeta {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

impl AppMeta {
    pub fn new(id: String, name: String) -> Self {
        let now = now_iso8601();
        Self {
            id,
            name,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

fn now_iso8601() -> String {
    // chrono is already a dependency; fall back to a simple UTC stamp if it fails.
    chrono::Utc::now().to_rfc3339()
}

// ── Registry (apps.json) ──────────────────────────────────────────────────

fn registry_path() -> Result<PathBuf, String> {
    workspace::apps_json_path()
}

fn read_registry() -> Result<Vec<AppMeta>, String> {
    let path = registry_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read registry: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse registry: {}", e))
}

fn write_registry(apps: &[AppMeta]) -> Result<(), String> {
    let path = registry_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create registry dir: {}", e))?;
    }
    let raw = serde_json::to_string_pretty(apps)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Failed to write registry: {}", e))
}

/// Ensure an app directory exists on disk (creates if missing).
fn ensure_app_dir(app_id: &str) -> Result<PathBuf, String> {
    let dir = workspace::app_dir(app_id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app dir: {}", e))?;
    Ok(dir)
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// List all apps from the registry.
#[tauri::command]
pub fn list_apps() -> Result<Vec<AppMeta>, String> {
    read_registry()
}

/// Create a new app: registers metadata and creates the on-disk directory.
#[tauri::command]
pub fn create_app(name: String) -> Result<AppMeta, String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("App name is required".to_string());
    }
    let id = uuid_v4();
    let meta = AppMeta::new(id.clone(), trimmed);

    // Create on-disk directory first.
    ensure_app_dir(&id)?;

    let mut apps = read_registry()?;
    apps.push(meta.clone());
    write_registry(&apps)?;
    Ok(meta)
}

/// Delete an app: removes registry entry and the on-disk directory.
#[tauri::command]
pub fn delete_app(app_id: String) -> Result<(), String> {
    let mut apps = read_registry()?;
    let before = apps.len();
    apps.retain(|p| p.id != app_id);
    if apps.len() == before {
        return Err(format!("App not found: {}", app_id));
    }
    write_registry(&apps)?;

    // Remove the on-disk directory (recursive, guarded to app root only).
    let dir = workspace::app_dir(&app_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to remove app dir: {}", e))?;
    }
    Ok(())
}

/// List files inside an app directory (recursive, excluding node_modules/.git).
#[tauri::command]
pub fn list_app_files(app_id: String) -> Result<Vec<String>, String> {
    let dir = workspace::app_dir(&app_id)?;
    if !dir.exists() {
        return Err(format!("App not found: {}", app_id));
    }
    let mut files = Vec::new();
    walk_app_files(&dir, &dir, &mut files)?;
    Ok(files)
}

fn walk_app_files(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if name == "node_modules" || name == ".git" || name == ".deskspawn" || name == "dist" {
                continue;
            }
            walk_app_files(root, &path, files)?;
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(root) {
                files.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(())
}

/// Read a file from an app directory (path-traversal safe).
#[tauri::command]
pub fn read_app_file(app_id: String, path: String) -> Result<String, String> {
    let dir = workspace::app_dir(&app_id)?;
    let target = dir.join(&path);
    if !security::is_path_safe(&dir, &target) {
        return Err("Path traversal detected".to_string());
    }
    if !target.is_file() {
        return Err(format!("File not found: {}", path));
    }
    let meta = target.metadata().map_err(|e| format!("Metadata error: {}", e))?;
    if meta.len() > 10_485_760 {
        return Err("File too large to read (max 10MB)".to_string());
    }
    fs::read_to_string(&target).map_err(|e| format!("Failed to read file: {}", e))
}

/// Write a file into an app directory (path-traversal safe, creates parents).
#[tauri::command]
pub fn write_app_file(app_id: String, path: String, content: String) -> Result<(), String> {
    let dir = workspace::app_dir(&app_id)?;
    let target = dir.join(&path);
    if !security::is_path_safe(&dir, &target) {
        return Err("Path traversal detected".to_string());
    }
    // Basic extension allowlist for app source files.
    if !security::is_extension_allowed(&path) {
        return Err(format!("Extension not allowed: {}", path));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {}", e))?;
    }
    fs::write(&target, content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// Write multiple files atomically-ish (used for template scaffolding).
#[tauri::command]
pub fn write_app_files(
    app_id: String,
    files: Vec<(String, String)>,
) -> Result<usize, String> {
    let dir = workspace::app_dir(&app_id)?;
    ensure_dir_exists(&dir)?;
    let mut written = 0usize;
    for (path, content) in files {
        let target = dir.join(&path);
        if !security::is_path_safe(&dir, &target) {
            return Err(format!("Path traversal detected: {}", path));
        }
        if !security::is_extension_allowed(&path) {
            return Err(format!("Extension not allowed: {}", path));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {}", e))?;
        }
        fs::write(&target, content).map_err(|e| format!("Failed to write file {}: {}", path, e))?;
        written += 1;
    }
    Ok(written)
}

/// Load chat history for an app from its SQLite DB (ADR-009).
#[tauri::command]
pub async fn get_chat_history(app_id: String) -> Result<Vec<ChatMessage>, String> {
    let pool = crate::engine::storage::open_chat_db(&app_id).await?;
    let rows = crate::engine::storage::load_messages(&pool, &app_id).await?;
    let msgs = rows
        .into_iter()
        .map(|(id, role, content, created_at)| ChatMessage {
            id,
            role,
            content,
            created_at,
        })
        .collect();
    crate::engine::storage::close(pool).await;
    Ok(msgs)
}

/// Append a chat message to the app's SQLite DB (ADR-009).
#[tauri::command]
pub async fn append_chat_message(
    app_id: String,
    role: String,
    content: String,
) -> Result<i64, String> {
    let pool = crate::engine::storage::open_chat_db(&app_id).await?;
    let id = crate::engine::storage::append_message(&pool, &app_id, &role, &content).await?;
    crate::engine::storage::close(pool).await;
    Ok(id)
}

/// Chat message shape returned to the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessage {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

fn ensure_dir_exists(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create dir: {}", e))
}

fn uuid_v4() -> String {
    // Simple UUID v4 from getrandom via rand? We avoid extra deps: use a
    // timestamp + random suffix. Good enough for app ids.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("app-{:x}-{:x}", ts, std::process::id())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    // Tests mutate the shared DESKSPAWN_ROOT env var; the shared lock lives
    // in engine::workspace (TEST_ENV_LOCK) to avoid cross-module races.
    fn with_temp_root<T>(f: impl FnOnce() -> T) -> T {
        // Poison-tolerant lock: a panicking test must not poison subsequent tests.
        let _guard = crate::engine::workspace::test_env_lock();
        let tmp =
            std::env::temp_dir().join(format!("deskspawn-apps-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        std::env::set_var("DESKSPAWN_ROOT", &tmp);
        let result = f();
        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = fs::remove_dir_all(&tmp);
        result
    }

    #[test]
    fn create_and_list_app() {
        with_temp_root(|| {
            let meta = create_app("My App".to_string()).unwrap();
            assert!(!meta.id.is_empty());
            assert_eq!(meta.name, "My App");

            let apps = list_apps().unwrap();
            assert_eq!(apps.len(), 1);
            assert_eq!(apps[0].id, meta.id);
        });
    }

    #[test]
    fn create_app_trims_whitespace_and_rejects_empty() {
        with_temp_root(|| {
            let meta = create_app("   Spaced Name   ".to_string()).unwrap();
            assert_eq!(meta.name, "Spaced Name");

            assert!(create_app("   ".to_string()).is_err());
        });
    }

    #[test]
    fn write_and_read_app_file() {
        with_temp_root(|| {
            let meta = create_app("Files".to_string()).unwrap();
            write_app_file(meta.id.clone(), "src/main.tsx".to_string(), "export const x = 1;".to_string()).unwrap();

            let content = read_app_file(meta.id.clone(), "src/main.tsx".to_string()).unwrap();
            assert_eq!(content, "export const x = 1;");

            // Nested dirs are created.
            assert!(workspace::app_dir(&meta.id).unwrap().join("src").join("main.tsx").exists());
        });
    }

    #[test]
    fn app_file_path_traversal_is_blocked() {
        with_temp_root(|| {
            let meta = create_app("Secure".to_string()).unwrap();
            assert!(write_app_file(meta.id.clone(), "../escape.txt".to_string(), "x".to_string()).is_err());
            assert!(read_app_file(meta.id.clone(), "../../etc/passwd".to_string()).is_err());
        });
    }

    #[test]
    fn delete_app_removes_dir_and_registry() {
        with_temp_root(|| {
            let meta = create_app("DeleteMe".to_string()).unwrap();
            let dir = workspace::app_dir(&meta.id).unwrap();
            assert!(dir.exists());

            delete_app(meta.id.clone()).unwrap();
            assert!(!dir.exists());
            assert_eq!(list_apps().unwrap().len(), 0);

            // Deleting again errors.
            assert!(delete_app(meta.id.clone()).is_err());
        });
    }

    #[test]
    fn list_app_files_excludes_node_modules() {
        with_temp_root(|| {
            let meta = create_app("ListFiles".to_string()).unwrap();
            write_app_files(
                meta.id.clone(),
                vec![
                    ("package.json".to_string(), "{}".to_string()),
                    ("src/App.tsx".to_string(), "export default function App() { return null; }".to_string()),
                    ("node_modules/dep/index.js".to_string(), "ignored".to_string()),
                ],
            )
            .unwrap();

            let files = list_app_files(meta.id.clone()).unwrap();
            assert!(files.contains(&"package.json".to_string()));
            assert!(files.contains(&"src/App.tsx".to_string()));
            assert!(!files.iter().any(|f| f.contains("node_modules")), "node_modules must be excluded");
        });
    }

    #[test]
    fn write_app_files_bulk() {
        with_temp_root(|| {
            let meta = create_app("Bulk".to_string()).unwrap();
            let n = write_app_files(
                meta.id.clone(),
                vec![
                    ("a.txt".to_string(), "1".to_string()),
                    ("b.txt".to_string(), "2".to_string()),
                    ("sub/c.txt".to_string(), "3".to_string()),
                ],
            )
            .unwrap();
            assert_eq!(n, 3);
            assert_eq!(read_app_file(meta.id.clone(), "sub/c.txt".to_string()).unwrap(), "3");
        });
    }
}
