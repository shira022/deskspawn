//! First-run setup — initializes the `~/deskspawn` tree and runtime state.
//!
//! Called from the Tauri setup hook. Safe to run on every launch (idempotent):
//! it ensures directories exist and seeds the app registry if missing.

use crate::engine::workspace;
use std::fs;
use std::path::Path;

/// Run idempotent first-run setup. Returns a summary string for logging.
pub fn run_setup() -> Result<String, String> {
    let mut steps = Vec::new();

    // 1. Ensure the directory tree exists.
    let root = workspace::ensure_deskspawn_tree()?;
    steps.push(format!("root={}", root.display()));

    // 2. Seed an empty app registry if missing.
    let apps_json = workspace::apps_json_path()?;
    if !apps_json.exists() {
        fs::write(&apps_json, "[]\n")
            .map_err(|e| format!("Failed to seed app registry: {}", e))?;
        steps.push("seeded apps.json".to_string());
    } else {
        steps.push("apps.json exists".to_string());
    }

    // 3. Verify templates directory is present (contents are populated
    //    when templates are bundled; the directory itself is a sentinel).
    let templates = workspace::templates_dir()?;
    ensure_dir(&templates, "templates")?;
    steps.push(format!("templates={}", templates.display()));

    // 4. Ensure logs directory (sidecar/Rust log output target).
    let logs = workspace::logs_dir()?;
    ensure_dir(&logs, "logs")?;
    steps.push(format!("logs={}", logs.display()));

    Ok(steps.join("; "))
}

fn ensure_dir(dir: &Path, label: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create {} dir {}: {}", label, dir.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Setup must be idempotent — running twice yields no errors and keeps
    /// the registry intact.
    #[test]
    fn setup_is_idempotent() {
        let _guard = crate::engine::workspace::test_env_lock();
        // Use an isolated temp root via DESKSPAWN_ROOT env var.
        let tmp = std::env::temp_dir().join(format!("deskspawn-setup-test-{}", std::process::id()));
        std::env::set_var("DESKSPAWN_ROOT", &tmp);

        let first = run_setup();
        assert!(first.is_ok(), "first run failed: {:?}", first);

        let apps_json = workspace::apps_json_path().unwrap();
        assert!(apps_json.exists(), "apps.json must exist after setup");
        assert_eq!(
            fs::read_to_string(&apps_json).unwrap(),
            "[]\n",
            "registry must start empty"
        );

        // Second run: must not fail and must not duplicate anything.
        let second = run_setup();
        assert!(second.is_ok(), "second run failed: {:?}", second);
        assert_eq!(
            fs::read_to_string(&apps_json).unwrap(),
            "[]\n",
            "registry must be unchanged after second run"
        );

        // Cleanup
        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = fs::remove_dir_all(&tmp);
    }

    /// Root directory resolution honors DESKSPAWN_ROOT when set.
    #[test]
    fn root_dir_honors_env_override() {
        let _guard = crate::engine::workspace::test_env_lock();
        let tmp = std::env::temp_dir().join(format!("deskspawn-root-test-{}", std::process::id()));
        std::env::set_var("DESKSPAWN_ROOT", &tmp);

        let root = workspace::root_dir().unwrap();
        assert_eq!(root, tmp);

        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = fs::remove_dir_all(&tmp);
    }

    /// A relative DESKSPAWN_ROOT is rejected (must be absolute).
    #[test]
    fn root_dir_rejects_relative_override() {
        let _guard = crate::engine::workspace::test_env_lock();
        std::env::set_var("DESKSPAWN_ROOT", "relative/path");
        let root = workspace::root_dir();
        assert!(root.is_ok(), "falls back to home-based root");
        let root = root.unwrap();
        assert!(root.is_absolute(), "root must be absolute");
        std::env::remove_var("DESKSPAWN_ROOT");
    }

    /// All subdirectory helpers resolve under the root.
    #[test]
    fn subdirs_resolve_under_root() {
        let _guard = crate::engine::workspace::test_env_lock();
        let tmp = std::env::temp_dir().join(format!("deskspawn-subdir-test-{}", std::process::id()));
        std::env::set_var("DESKSPAWN_ROOT", &tmp);

        let root = workspace::root_dir().unwrap();
        assert_eq!(workspace::apps_dir().unwrap(), root.join("apps"));
        assert_eq!(workspace::templates_dir().unwrap(), root.join("templates"));
        assert_eq!(workspace::config_dir().unwrap(), root.join("config"));
        assert_eq!(workspace::tools_dir().unwrap(), root.join("tools"));
        assert_eq!(workspace::workspace_dir().unwrap(), root.join("workspace"));
        assert_eq!(workspace::logs_dir().unwrap(), root.join("logs"));

        let pid = "test-app";
        assert_eq!(workspace::app_dir(pid).unwrap(), root.join("apps").join(pid));
        assert_eq!(
            workspace::app_chat_db_path(pid).unwrap(),
            root.join("apps").join(pid).join(".deskspawn").join("chat.db")
        );

        std::env::remove_var("DESKSPAWN_ROOT");
        let _ = fs::remove_dir_all(&tmp);
    }
}
