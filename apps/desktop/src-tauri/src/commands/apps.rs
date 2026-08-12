//! App management commands — real files on disk under `~/deskspawn/apps`.
//!
//! Desktop-only (see ADR-008). The web version keeps using IndexedDB/OPFS.
//! Registry: `~/deskspawn/apps/apps.json` (JSON array of AppMeta).

use crate::engine::workspace;
use crate::engine::security;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::fs;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

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
    // アトミック書き込み: 一時ファイル → rename。クラッシュ時のレジストリ破損を防ぐ。
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &raw).map_err(|e| format!("Failed to write registry tmp: {}", e))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to commit registry: {}", e))
}

/// app_id の形式検証 + レジストリ存在チェック。
///
/// セキュリティ: 許可形式を `app-<32 hex>`（UUID v4）のみに限定することで、
/// `..` や絶対パスを含む app_id によるパストラバーサルを構造的に排除する。
/// （旧形式 `proj-*` / `app-<nanos>-<pid>` は 0.x 開発期のみで、正式リリース前）
fn validate_app_id(app_id: &str) -> Result<(), String> {
    let ok_format = app_id.len() == 36
        && app_id.starts_with("app-")
        && app_id[4..].chars().all(|c| c.is_ascii_hexdigit());
    if !ok_format {
        return Err(format!("Invalid app id format: {}", app_id));
    }
    let apps = read_registry()?;
    if !apps.iter().any(|a| a.id == app_id) {
        return Err(format!("App not found: {}", app_id));
    }
    Ok(())
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
    validate_app_id(&app_id)?;
    let mut apps = read_registry()?;
    apps.retain(|p| p.id != app_id);
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
    validate_app_id(&app_id)?;
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
    validate_app_id(&app_id)?;
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

/// Delete a file from an app directory (path-traversal safe).
///
/// C1 fix (web-storage audit 2026-08-12): the frontend's desktop `deleteAppFile`
/// used to write an empty string instead of deleting, which left "deleted"
/// files as 0-byte files. Idempotent: missing file is not an error.
#[tauri::command]
pub fn delete_app_file(app_id: String, path: String) -> Result<(), String> {
    validate_app_id(&app_id)?;
    let dir = workspace::app_dir(&app_id)?;
    let target = dir.join(&path);
    if !security::is_path_safe(&dir, &target) {
        return Err("Path traversal detected".to_string());
    }
    if !target.is_file() {
        return Ok(());
    }
    fs::remove_file(&target).map_err(|e| format!("Failed to delete file: {}", e))?;
    Ok(())
}

/// Write a file into an app directory (path-traversal safe, creates parents).
#[tauri::command]
pub fn write_app_file(app_id: String, path: String, content: String) -> Result<(), String> {
    validate_app_id(&app_id)?;
    let dir = workspace::app_dir(&app_id)?;
    let target = dir.join(&path);
    if !security::is_path_safe(&dir, &target) {
        return Err("Path traversal detected".to_string());
    }
    // Basic extension allowlist for app source files.
    if !security::is_extension_allowed(&path) {
        return Err(format!("Extension not allowed: {}", path));
    }
    // M4: 生成コードの危険パターン検証（child_process / eval 等）
    if security::is_typescript_file(&path) {
        security::check_typescript_security(&content)
            .map_err(|v| format!("Security check failed for {}: {}", path, v.join(", ")))?;
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
    validate_app_id(&app_id)?;
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
        // M4: 生成コードの危険パターン検証
        if security::is_typescript_file(&path) {
            security::check_typescript_security(&content)
                .map_err(|v| format!("Security check failed for {}: {}", path, v.join(", ")))?;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {}", e))?;
        }
        fs::write(&target, content).map_err(|e| format!("Failed to write file {}: {}", path, e))?;
        written += 1;
    }
    Ok(written)
}

/// Load chat history for an app from its SQLite DB (ADR-009 / ADR-013).
#[tauri::command]
pub async fn get_chat_history(app_id: String) -> Result<Vec<ChatMessage>, String> {
    validate_app_id(&app_id)?;
    let pool = crate::engine::storage::open_chat_db(&app_id).await?;
    let rows = crate::engine::storage::load_messages(&pool, &app_id).await?;
    let msgs = rows
        .into_iter()
        .map(|r| ChatMessage {
            client_id: r.client_id,
            role: r.role,
            content: r.content,
            payload: r.payload,
            created_at: r.created_at,
        })
        .collect();
    crate::engine::storage::close(pool).await;
    Ok(msgs)
}

/// Replace-all save of an app's complete chat history (atomic, ADR-013).
///
/// The frontend passes every message it currently holds; Rust deletes and
/// re-inserts within a single transaction. `payload` carries the full
/// frontend message object (stepLogs / phaseOutputs / usage / checkpointId /
/// timestamp) as JSON so a reload restores the chat exactly as rendered.
#[tauri::command]
pub async fn save_chat_messages(
    app_id: String,
    messages: Vec<ChatMessageInput>,
) -> Result<(), String> {
    validate_app_id(&app_id)?;
    let rows: Vec<crate::engine::storage::ChatMessageRow> = messages
        .into_iter()
        .map(|m| crate::engine::storage::ChatMessageRow {
            client_id: Some(m.client_id),
            role: m.role,
            content: m.content,
            payload: m.payload,
            created_at: m.created_at,
        })
        .collect();
    let pool = crate::engine::storage::open_chat_db(&app_id).await?;
    crate::engine::storage::save_messages(&pool, &app_id, &rows).await?;
    crate::engine::storage::close(pool).await;
    Ok(())
}

/// Chat message shape returned to the frontend (v2: includes client_id + payload).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessage {
    /// Frontend message id (`msg-…`); backfilled `legacy-<id>` for v1 rows.
    pub client_id: Option<String>,
    pub role: String,
    pub content: String,
    /// Full frontend message object as JSON (stepLogs / phaseOutputs / usage / …).
    pub payload: Option<String>,
    /// DB timestamp; None for new rows written by the frontend (payload has the real timestamp).
    pub created_at: Option<String>,
}

/// Input shape for `save_chat_messages`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ChatMessageInput {
    pub client_id: String,
    pub role: String,
    pub content: String,
    pub payload: Option<String>,
    pub created_at: Option<String>,
}

fn ensure_dir_exists(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create dir: {}", e))
}

fn uuid_v4() -> String {
    // セキュアなランダム ID（UUID v4, 122bit エントロピー）
    format!("app-{}", uuid::Uuid::new_v4().simple())
}

// ── Export / Import (zip backup, M1) ─────────────────────────────────────────

/// zip に含めるべきでないパス（秘密情報・キャッシュ・依存物）。
fn is_excluded_zip_path(name: &str) -> bool {
    const EXCLUDED: &[&str] = &["node_modules/", ".git/", "dist/", ".deskspawn/", ".cache/"];
    EXCLUDED.iter().any(|p| name.starts_with(p))
}

/// シークレットを含み得る環境変数ファイル（.env / .env.local 等）。
/// .env.example は値の入っていないテンプレートのため許可する。
fn is_env_file(name: &str) -> bool {
    let base = name.rsplit('/').next().unwrap_or(name);
    if base == ".env" {
        return true;
    }
    base.starts_with(".env.") && !base.ends_with(".example")
}

/// zip エントリ名の安全性チェック（zip slip 対策）。
/// - `..` による親ディレクトリ脱出を拒否
/// - 絶対パス / Windows ドライブパス / バックスラッシュを拒否
fn is_zip_entry_safe(name: &str) -> bool {
    if name.is_empty() || name.starts_with('/') || name.contains('\\') {
        return false;
    }
    // Windows ドライブレター（C: 等）
    if name.len() >= 2 && name.as_bytes()[1] == b':' {
        return false;
    }
    for comp in name.split('/') {
        if comp.is_empty() || comp == "." || comp == ".." {
            return false;
        }
    }
    true
}

/// アプリのソースファイルを（メモリ上で）zip 化する。deskspawn.json メタを含む。
fn build_app_zip(meta_name: &str, files: &[(String, String)]) -> Result<Vec<u8>, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let meta_json = serde_json::json!({
            "name": meta_name,
            "version": "1.0",
            "exportedAt": now_iso8601(),
        });
        zip.start_file("deskspawn.json", options)
            .map_err(|e| format!("Zip write failed: {}", e))?;
        zip.write_all(meta_json.to_string().as_bytes())
            .map_err(|e| format!("Zip write failed: {}", e))?;

        for (path, content) in files {
            zip.start_file(path, options)
                .map_err(|e| format!("Zip write failed ({}): {}", path, e))?;
            zip.write_all(content.as_bytes())
                .map_err(|e| format!("Zip write failed ({}): {}", path, e))?;
        }
        zip.finish()
            .map_err(|e| format!("Zip finish failed: {}", e))?;
    }
    Ok(buf.into_inner())
}

/// エクスポート: 保存ダイアログ → zip 生成 → 書き込み。
/// デスクトップ版は実ファイルがディスクにあるため Rust 側で完結する（M1-B）。
#[tauri::command]
pub fn export_app_zip(app: tauri::AppHandle, app_id: String) -> Result<String, String> {
    validate_app_id(&app_id)?;

    let dir = workspace::app_dir(&app_id)?;
    if !dir.exists() {
        return Err(format!("App not found: {}", app_id));
    }

    // ファイル収集（.env はシークレット同梱防止のため除外）
    let mut rel_files = Vec::new();
    walk_app_files_export(&dir, &dir, &mut rel_files)?;
    if rel_files.is_empty() {
        return Err("No source files found to export".to_string());
    }

    // 内容を読み込む（サイズ上限: 単一 10MB・合計 50MB）
    let mut files: Vec<(String, String)> = Vec::new();
    let mut total = 0usize;
    for rel in &rel_files {
        let content = fs::read_to_string(dir.join(rel))
            .map_err(|e| format!("Failed to read {}: {}", rel, e))?;
        if content.len() > 10_485_760 {
            return Err(format!("File too large to export: {}", rel));
        }
        total += content.len();
        if total > 50_000_000 {
            return Err("App too large to export (max 50MB total)".to_string());
        }
        files.push((rel.clone(), content));
    }

    // アプリ名（レジストリから）
    let apps = read_registry()?;
    let meta_name = apps
        .iter()
        .find(|a| a.id == app_id)
        .map(|a| a.name.clone())
        .unwrap_or_else(|| "App".to_string());

    let zip_bytes = build_app_zip(&meta_name, &files)?;

    // 保存ダイアログ
    let safe_name: String = meta_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let file_path = app
        .dialog()
        .file()
        .add_filter("DeskSpawn app", &["zip"])
        .set_file_name(format!("{}.deskspawn.zip", safe_name))
        .blocking_save_file()
        .ok_or_else(|| "Export cancelled".to_string())?
        .into_path()
        .map_err(|e| format!("Invalid save path: {}", e))?;

    fs::write(&file_path, &zip_bytes)
        .map_err(|e| format!("Failed to write zip: {}", e))?;
    Ok(file_path.display().to_string())
}

/// インポート: ファイル選択ダイアログ → zip 展開（zip slip 対策込み）→ 新規アプリ登録。
#[tauri::command]
pub fn import_app_zip(app: tauri::AppHandle) -> Result<AppMeta, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("DeskSpawn app", &["zip"])
        .blocking_pick_file()
        .ok_or_else(|| "Import cancelled".to_string())?
        .into_path()
        .map_err(|e| format!("Invalid file path: {}", e))?;

    let bytes = fs::read(&file_path).map_err(|e| format!("Failed to read zip: {}", e))?;
    if bytes.len() > 50_000_000 {
        return Err("Archive too large (max 50MB)".to_string());
    }

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("Invalid zip file: {}", e))?;

    let mut entries: Vec<(String, String)> = Vec::new();
    let mut app_name: Option<String> = None;
    let mut total_size = 0usize;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let name = entry.name().to_string();

        if entry.is_dir() {
            continue;
        }
        if name == "deskspawn.json" {
            let mut s = String::new();
            entry
                .read_to_string(&mut s)
                .map_err(|e| format!("Failed to read deskspawn.json: {}", e))?;
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                if let Some(n) = v.get("name").and_then(|x| x.as_str()) {
                    app_name = Some(n.to_string());
                }
            }
            continue;
        }

        // zip slip 対策
        if !is_zip_entry_safe(&name) {
            return Err(format!("Unsafe zip entry rejected: {}", name));
        }
        if is_excluded_zip_path(&name) || is_env_file(&name) {
            continue;
        }
        if !security::is_extension_allowed(&name) {
            return Err(format!("Extension not allowed: {}", name));
        }
        if entry.size() > 10_485_760 {
            return Err(format!("File too large in archive: {}", name));
        }
        total_size += entry.size() as usize;
        if total_size > 50_000_000 {
            return Err("Archive too large (max 50MB)".to_string());
        }

        let mut content = String::new();
        entry
            .read_to_string(&mut content)
            .map_err(|e| format!("Failed to read entry {}: {}", name, e))?;
        entries.push((name, content));
    }

    if entries.is_empty() {
        return Err("No source files found in the archive".to_string());
    }
    if entries.len() > 1000 {
        return Err("Too many files in archive (max 1000)".to_string());
    }

    // 新規アプリとして登録（ディレクトリ作成 → 書き込み → レジストリ登録）
    let id = uuid_v4();
    let name = app_name.unwrap_or_else(|| "Imported App".to_string());
    let dir = workspace::app_dir(&id)?;
    ensure_dir_exists(&dir)?;
    for (path, content) in &entries {
        let target = dir.join(path);
        if !security::is_path_safe(&dir, &target) {
            return Err(format!("Path traversal detected: {}", path));
        }
        // インポートコードも M4 の危険パターン検証を通す
        if security::is_typescript_file(path) {
            security::check_typescript_security(content)
                .map_err(|v| format!("Security check failed for {}: {}", path, v.join(", ")))?;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dir: {}", e))?;
        }
        fs::write(&target, content).map_err(|e| format!("Failed to write {}: {}", path, e))?;
    }

    let meta = AppMeta::new(id, name);
    let mut apps = read_registry()?;
    apps.push(meta.clone());
    write_registry(&apps)?;
    Ok(meta)
}

/// walk_app_files の export 版（.env / .env.* を除外）。
fn walk_app_files_export(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if name == "node_modules" || name == ".git" || name == ".deskspawn" || name == "dist" {
                continue;
            }
            walk_app_files_export(root, &path, files)?;
        } else if path.is_file() {
            if is_env_file(&name) {
                continue;
            }
            if let Ok(rel) = path.strip_prefix(root) {
                files.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(())
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

    #[test]
    fn app_id_traversal_and_invalid_format_is_rejected() {
        with_temp_root(|| {
            let meta = create_app("Secure2".to_string()).unwrap();

            // app_id に ../ を含む攻撃 → 形式検証で構造的に拒否（C1）
            assert!(read_app_file("..".to_string(), "config/config.json".to_string()).is_err());
            assert!(write_app_file("..".to_string(), "config/config.json".to_string(), "x".to_string()).is_err());
            assert!(write_app_files("../../".to_string(), vec![("a.txt".to_string(), "x".to_string())]).is_err());
            assert!(list_app_files("../..".to_string()).is_err());
            assert!(delete_app("..".to_string()).is_err());

            // 不正形式（レジストリに無い ID・旧形式・非 hex）
            assert!(read_app_file("app-00000000000000000000000000000000".to_string(), "a.txt".to_string()).is_err());
            assert!(read_app_file("proj-abc".to_string(), "a.txt".to_string()).is_err());
            assert!(read_app_file("app-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz".to_string(), "a.txt".to_string()).is_err());
            assert!(read_app_file("App-0123456789abcdef0123456789abcdef".to_string(), "a.txt".to_string()).is_err());

            // 正常系は引き続き動く（存在しないファイルは File not found）
            assert!(read_app_file(meta.id.clone(), "no-such-file.txt".to_string()).is_err());
        });
    }

    #[test]
    fn forbidden_ts_pattern_blocks_ai_generated_code() {
        with_temp_root(|| {
            let meta = create_app("TsGuard".to_string()).unwrap();
            // M4: 危険パターンは書き込み拒否
            assert!(write_app_file(
                meta.id.clone(),
                "src/evil.ts".to_string(),
                "child_process.exec('rm -rf /')".to_string(),
            )
            .is_err());
            assert!(write_app_files(
                meta.id.clone(),
                vec![("src/evil2.tsx".to_string(), "eval('alert(1)')".to_string())],
            )
            .is_err());
            // 正当なコードは許可（fetch 等）
            write_app_file(
                meta.id.clone(),
                "src/api.ts".to_string(),
                "const res = await fetch('/api/data'); export { res };".to_string(),
            )
            .unwrap();
            // 非 TS ファイルは検証対象外
            write_app_file(meta.id.clone(), "data.json".to_string(), "{}".to_string()).unwrap();
        });
    }

    #[test]
    fn zip_entry_safety_checks() {
        assert!(is_zip_entry_safe("src/App.tsx"));
        assert!(is_zip_entry_safe("package.json"));
        assert!(!is_zip_entry_safe("../escape.txt"));
        assert!(!is_zip_entry_safe("a/../../escape.txt"));
        assert!(!is_zip_entry_safe("/etc/passwd"));
        assert!(!is_zip_entry_safe("C:/windows/evil.txt"));
        assert!(!is_zip_entry_safe("..\\evil.txt"));
        assert!(!is_zip_entry_safe("a\\..\\evil.txt"));
        assert!(!is_zip_entry_safe(""));
        assert!(!is_zip_entry_safe("a//b"));
        assert!(!is_zip_entry_safe("./a"));
    }

    #[test]
    fn env_file_detection() {
        assert!(is_env_file(".env"));
        assert!(is_env_file(".env.local"));
        assert!(is_env_file("src/.env"));
        assert!(is_env_file("config/.env.production"));
        // .env.example はテンプレートとして許可
        assert!(!is_env_file(".env.example"));
        assert!(!is_env_file("src/App.tsx"));
        assert!(!is_env_file("package.json"));
    }

    #[test]
    fn build_app_zip_roundtrip() {
        let files = vec![
            ("src/App.tsx".to_string(), "export default function App() { return null; }".to_string()),
            ("package.json".to_string(), "{}".to_string()),
        ];
        let bytes = build_app_zip("Test App", &files).unwrap();

        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(archive.len(), 3); // deskspawn.json + 2 files

        {
            let mut meta = archive.by_name("deskspawn.json").unwrap();
            let mut s = String::new();
            meta.read_to_string(&mut s).unwrap();
            assert!(s.contains("Test App"));
        } // meta はここで drop（ZipFile の借用解放）

        let mut src = archive.by_name("src/App.tsx").unwrap();
        let mut src_s = String::new();
        src.read_to_string(&mut src_s).unwrap();
        assert!(src_s.contains("return null"));
    }

    #[test]
    fn uuid_v4_format_is_strict() {
        let id = uuid_v4();
        assert_eq!(id.len(), 36);
        assert!(id.starts_with("app-"));
        assert!(id[4..].chars().all(|c| c.is_ascii_hexdigit()));
        // 一意性
        let ids: std::collections::HashSet<String> = (0..100).map(|_| uuid_v4()).collect();
        assert_eq!(ids.len(), 100);
    }
}

/// get_chat_history の同期ラッパー（async 関数をテストから呼ぶためのヘルパー）。
#[cfg(test)]
fn get_chat_history_sync(app_id: &str) -> Result<Vec<ChatMessage>, String> {
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(get_chat_history(app_id.to_string()))
}

#[cfg(test)]
mod chat_save_tests {
    use super::*;

    #[test]
    fn save_and_load_chat_messages_roundtrip() {
        let _guard = crate::engine::workspace::test_env_lock();
        let tmp = std::env::temp_dir().join(format!("deskspawn-chatcmd-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        std::env::set_var("DESKSPAWN_ROOT", &tmp);
        let rt = tokio::runtime::Runtime::new().unwrap();

        let meta = create_app("Chat".to_string()).unwrap();
        let msgs = vec![
            ChatMessageInput {
                client_id: "msg-a".into(),
                role: "user".into(),
                content: "hello".into(),
                payload: Some(r#"{"id":"msg-a","role":"user","content":"hello","timestamp":1}"#.into()),
                created_at: None,
            },
            ChatMessageInput {
                client_id: "msg-b".into(),
                role: "assistant".into(),
                content: "hi".into(),
                payload: Some(
                    r#"{"id":"msg-b","role":"assistant","content":"hi","stepLogs":[{"step":1,"toolName":"read_file","status":"success"}]}"#
                        .into(),
                ),
                created_at: None,
            },
        ];
        rt.block_on(save_chat_messages(meta.id.clone(), msgs)).unwrap();

        let loaded = get_chat_history_sync(&meta.id).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].client_id.as_deref(), Some("msg-a"));
        assert!(loaded[1].payload.as_deref().unwrap().contains("stepLogs"));

        // Replace-all: saving one message drops the previous two.
        rt.block_on(save_chat_messages(
            meta.id.clone(),
            vec![ChatMessageInput {
                client_id: "msg-c".into(),
                role: "user".into(),
                content: "only".into(),
                payload: Some(r#"{"id":"msg-c","role":"user","content":"only"}"#.into()),
                created_at: None,
            }],
        ))
        .unwrap();
        let after = get_chat_history_sync(&meta.id).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].client_id.as_deref(), Some("msg-c"));

        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = fs::remove_dir_all(&tmp);
    }
}
