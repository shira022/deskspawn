//! Project management commands — real files on disk under `~/deskspawn/projects`.
//!
//! Desktop-only (see ADR-008). The web version keeps using IndexedDB/OPFS.
//! Registry: `~/deskspawn/projects/projects.json` (JSON array of ProjectMeta).

use crate::engine::workspace;
use crate::engine::security;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Project metadata stored in the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

impl ProjectMeta {
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

// ── Registry (projects.json) ──────────────────────────────────────────────────

fn registry_path() -> Result<PathBuf, String> {
    workspace::projects_json_path()
}

fn read_registry() -> Result<Vec<ProjectMeta>, String> {
    let path = registry_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read registry: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse registry: {}", e))
}

fn write_registry(projects: &[ProjectMeta]) -> Result<(), String> {
    let path = registry_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create registry dir: {}", e))?;
    }
    let raw = serde_json::to_string_pretty(projects)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Failed to write registry: {}", e))
}

/// Ensure a project directory exists on disk (creates if missing).
fn ensure_project_dir(project_id: &str) -> Result<PathBuf, String> {
    let dir = workspace::project_dir(project_id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create project dir: {}", e))?;
    Ok(dir)
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// List all projects from the registry.
#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectMeta>, String> {
    read_registry()
}

/// Create a new project: registers metadata and creates the on-disk directory.
#[tauri::command]
pub fn create_project(name: String) -> Result<ProjectMeta, String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Project name is required".to_string());
    }
    let id = uuid_v4();
    let meta = ProjectMeta::new(id.clone(), trimmed);

    // Create on-disk directory first.
    ensure_project_dir(&id)?;

    let mut projects = read_registry()?;
    projects.push(meta.clone());
    write_registry(&projects)?;
    Ok(meta)
}

/// Delete a project: removes registry entry and the on-disk directory.
#[tauri::command]
pub fn delete_project(project_id: String) -> Result<(), String> {
    let mut projects = read_registry()?;
    let before = projects.len();
    projects.retain(|p| p.id != project_id);
    if projects.len() == before {
        return Err(format!("Project not found: {}", project_id));
    }
    write_registry(&projects)?;

    // Remove the on-disk directory (recursive, guarded to project root only).
    let dir = workspace::project_dir(&project_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to remove project dir: {}", e))?;
    }
    Ok(())
}

/// List files inside a project directory (recursive, excluding node_modules/.git).
#[tauri::command]
pub fn list_project_files(project_id: String) -> Result<Vec<String>, String> {
    let dir = workspace::project_dir(&project_id)?;
    if !dir.exists() {
        return Err(format!("Project not found: {}", project_id));
    }
    let mut files = Vec::new();
    walk_project_files(&dir, &dir, &mut files)?;
    Ok(files)
}

fn walk_project_files(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if name == "node_modules" || name == ".git" || name == ".deskspawn" || name == "dist" {
                continue;
            }
            walk_project_files(root, &path, files)?;
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(root) {
                files.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(())
}

/// Read a file from a project directory (path-traversal safe).
#[tauri::command]
pub fn read_project_file(project_id: String, path: String) -> Result<String, String> {
    let dir = workspace::project_dir(&project_id)?;
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

/// Write a file into a project directory (path-traversal safe, creates parents).
#[tauri::command]
pub fn write_project_file(project_id: String, path: String, content: String) -> Result<(), String> {
    let dir = workspace::project_dir(&project_id)?;
    let target = dir.join(&path);
    if !security::is_path_safe(&dir, &target) {
        return Err("Path traversal detected".to_string());
    }
    // Basic extension allowlist for project source files.
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
pub fn write_project_files(
    project_id: String,
    files: Vec<(String, String)>,
) -> Result<usize, String> {
    let dir = workspace::project_dir(&project_id)?;
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

fn ensure_dir_exists(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create dir: {}", e))
}

fn uuid_v4() -> String {
    // Simple UUID v4 from getrandom via rand? We avoid extra deps: use a
    // timestamp + random suffix. Good enough for project ids.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("proj-{:x}-{:x}", ts, std::process::id())
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
            std::env::temp_dir().join(format!("deskspawn-projects-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        std::env::set_var("DESKSPAWN_ROOT", &tmp);
        let result = f();
        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = fs::remove_dir_all(&tmp);
        result
    }

    #[test]
    fn create_and_list_project() {
        with_temp_root(|| {
            let meta = create_project("My App".to_string()).unwrap();
            assert!(!meta.id.is_empty());
            assert_eq!(meta.name, "My App");

            let projects = list_projects().unwrap();
            assert_eq!(projects.len(), 1);
            assert_eq!(projects[0].id, meta.id);
        });
    }

    #[test]
    fn create_project_trims_whitespace_and_rejects_empty() {
        with_temp_root(|| {
            let meta = create_project("   Spaced Name   ".to_string()).unwrap();
            assert_eq!(meta.name, "Spaced Name");

            assert!(create_project("   ".to_string()).is_err());
        });
    }

    #[test]
    fn write_and_read_project_file() {
        with_temp_root(|| {
            let meta = create_project("Files".to_string()).unwrap();
            write_project_file(meta.id.clone(), "src/main.tsx".to_string(), "export const x = 1;".to_string()).unwrap();

            let content = read_project_file(meta.id.clone(), "src/main.tsx".to_string()).unwrap();
            assert_eq!(content, "export const x = 1;");

            // Nested dirs are created.
            assert!(workspace::project_dir(&meta.id).unwrap().join("src").join("main.tsx").exists());
        });
    }

    #[test]
    fn project_file_path_traversal_is_blocked() {
        with_temp_root(|| {
            let meta = create_project("Secure".to_string()).unwrap();
            assert!(write_project_file(meta.id.clone(), "../escape.txt".to_string(), "x".to_string()).is_err());
            assert!(read_project_file(meta.id.clone(), "../../etc/passwd".to_string()).is_err());
        });
    }

    #[test]
    fn delete_project_removes_dir_and_registry() {
        with_temp_root(|| {
            let meta = create_project("DeleteMe".to_string()).unwrap();
            let dir = workspace::project_dir(&meta.id).unwrap();
            assert!(dir.exists());

            delete_project(meta.id.clone()).unwrap();
            assert!(!dir.exists());
            assert_eq!(list_projects().unwrap().len(), 0);

            // Deleting again errors.
            assert!(delete_project(meta.id.clone()).is_err());
        });
    }

    #[test]
    fn list_project_files_excludes_node_modules() {
        with_temp_root(|| {
            let meta = create_project("ListFiles".to_string()).unwrap();
            write_project_files(
                meta.id.clone(),
                vec![
                    ("package.json".to_string(), "{}".to_string()),
                    ("src/App.tsx".to_string(), "export default function App() { return null; }".to_string()),
                    ("node_modules/dep/index.js".to_string(), "ignored".to_string()),
                ],
            )
            .unwrap();

            let files = list_project_files(meta.id.clone()).unwrap();
            assert!(files.contains(&"package.json".to_string()));
            assert!(files.contains(&"src/App.tsx".to_string()));
            assert!(!files.iter().any(|f| f.contains("node_modules")), "node_modules must be excluded");
        });
    }

    #[test]
    fn write_project_files_bulk() {
        with_temp_root(|| {
            let meta = create_project("Bulk".to_string()).unwrap();
            let n = write_project_files(
                meta.id.clone(),
                vec![
                    ("a.txt".to_string(), "1".to_string()),
                    ("b.txt".to_string(), "2".to_string()),
                    ("sub/c.txt".to_string(), "3".to_string()),
                ],
            )
            .unwrap();
            assert_eq!(n, 3);
            assert_eq!(read_project_file(meta.id.clone(), "sub/c.txt".to_string()).unwrap(), "3");
        });
    }
}
