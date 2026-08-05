//! Workspace path management — unifies all local storage under `~/deskspawn/`.
//!
//! The desktop app stores ALL user data under a single root directory in the
//! user's home: `<HOME>/deskspawn/`. This module is the single source of truth
//! for path resolution so that no other component hardcodes paths.
//!
//! Layout:
//! ```text
//! ~/deskspawn/
//! ├── projects/            project source files (real files on disk)
//! │   ├── projects.json    project registry (JSON)
//! │   └── <projectId>/     per-project directory (source + .deskspawn/)
//! ├── templates/           project templates (expanded on first run)
//! ├── config/              AI config (config.json)
//! ├── tools/               bundled tools (e.g. bun) — populated on first run
//! ├── workspace/           Rust workspace (execution sandbox)
//! └── logs/                sidecar/Rust logs
//! ```

use std::env;
use std::path::PathBuf;

/// Root directory name under the user's home directory.
pub const DESKSPAWN_ROOT_NAME: &str = "deskspawn";

/// Subdirectory names.
pub const PROJECTS_DIR_NAME: &str = "projects";
pub const TEMPLATES_DIR_NAME: &str = "templates";
pub const CONFIG_DIR_NAME: &str = "config";
pub const TOOLS_DIR_NAME: &str = "tools";
pub const WORKSPACE_DIR_NAME: &str = "workspace";
pub const LOGS_DIR_NAME: &str = "logs";

/// Project registry file name inside the projects directory.
pub const PROJECTS_JSON_NAME: &str = "projects.json";

/// Hidden per-project metadata directory.
pub const DESKSPAWN_META_DIR_NAME: &str = ".deskspawn";

/// Returns the deskspawn root directory: `<HOME>/deskspawn`.
///
/// Overridable via the `DESKSPAWN_ROOT` environment variable (absolute path).
pub fn root_dir() -> Result<PathBuf, String> {
    if let Ok(p) = env::var("DESKSPAWN_ROOT") {
        let pb = PathBuf::from(&p);
        if pb.is_absolute() {
            return Ok(pb);
        }
        log::warn!("DESKSPAWN_ROOT is not absolute, ignoring: {}", p);
    }
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map_err(|_| "HOME/USERPROFILE not set".to_string())?;
    Ok(PathBuf::from(home).join(DESKSPAWN_ROOT_NAME))
}

/// `~/deskspawn/projects`
pub fn projects_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join(PROJECTS_DIR_NAME))
}

/// `~/deskspawn/projects/projects.json`
pub fn projects_json_path() -> Result<PathBuf, String> {
    Ok(projects_dir()?.join(PROJECTS_JSON_NAME))
}

/// `~/deskspawn/templates`
pub fn templates_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join(TEMPLATES_DIR_NAME))
}

/// `~/deskspawn/config`
pub fn config_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join(CONFIG_DIR_NAME))
}

/// `~/deskspawn/tools`
pub fn tools_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join(TOOLS_DIR_NAME))
}

/// `~/deskspawn/workspace` — the Rust execution workspace.
pub fn workspace_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join(WORKSPACE_DIR_NAME))
}

/// `~/deskspawn/logs`
pub fn logs_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join(LOGS_DIR_NAME))
}

/// Per-project directory: `~/deskspawn/projects/<projectId>`
pub fn project_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(projects_dir()?.join(project_id))
}

/// Per-project metadata dir: `~/deskspawn/projects/<projectId>/.deskspawn`
pub fn project_meta_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project_id)?.join(DESKSPAWN_META_DIR_NAME))
}

/// Per-project chat DB: `~/deskspawn/projects/<projectId>/.deskspawn/chat.db`
pub fn project_chat_db_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(project_meta_dir(project_id)?.join("chat.db"))
}

/// Ensure the full directory tree exists. Returns the root path.
///
/// Creates: root, projects, templates, config, tools, workspace, logs.
pub fn ensure_deskspawn_tree() -> Result<PathBuf, String> {
    let root = root_dir()?;
    for sub in [
        PROJECTS_DIR_NAME,
        TEMPLATES_DIR_NAME,
        CONFIG_DIR_NAME,
        TOOLS_DIR_NAME,
        WORKSPACE_DIR_NAME,
        LOGS_DIR_NAME,
    ] {
        let dir = root.join(sub);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    }
    log::info!("DeskSpawn root tree ensured at {:?}", root);
    Ok(root)
}

/// The workspace path used by the Rust backend (harness / security server).
///
/// This replaces the old cwd-dependent resolution. Priority:
/// 1. `DESKSPAWN_WORKSPACE` env (explicit override, kept for compatibility)
/// 2. `~/deskspawn/workspace` (default — stable, home-based)
pub fn determine_workspace_path() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("DESKSPAWN_WORKSPACE") {
        let p = PathBuf::from(path);
        if p.is_absolute() {
            log::info!("Using workspace from DESKSPAWN_WORKSPACE: {:?}", p);
            return Ok(p);
        }
    }
    let ws = workspace_dir()?;
    log::info!("Using workspace from deskspawn root: {:?}", ws);
    Ok(ws)
}
