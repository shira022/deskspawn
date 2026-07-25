use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const BACKUPS_DIR: &str = ".deskspawn/backups";
const MAX_BACKUPS: usize = 5;

/// Create a backup of the given files. Returns a backup ID (timestamp string).
///
/// Files are copied to `.deskspawn/backups/<timestamp>/<relative_path>`.
pub fn create_backup(workspace: &Path, files: &[String]) -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get timestamp: {}", e))?
        .as_millis()
        .to_string();

    let backup_root = workspace.join(BACKUPS_DIR).join(&timestamp);
    fs::create_dir_all(&backup_root)
        .map_err(|e| format!("Failed to create backup directory: {}", e))?;

    for file_path_str in files {
        let src = workspace.join(file_path_str);
        if !src.exists() {
            continue;
        }
        let dest = backup_root.join(file_path_str);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create backup subdirectory: {}", e))?;
        }
        fs::copy(&src, &dest)
            .map_err(|e| format!("Failed to backup file {}: {}", src.display(), e))?;
    }

    // Cleanup old backups beyond the max limit
    prune_old_backups(workspace)?;

    Ok(timestamp)
}

/// Restore files from a specific backup.
pub fn restore_backup(workspace: &Path, backup_id: &str) -> Result<(), String> {
    let backup_root = workspace.join(BACKUPS_DIR).join(backup_id);
    if !backup_root.exists() {
        return Err(format!("Backup not found: {}", backup_id));
    }

    restore_dir(workspace, &backup_root, &backup_root)
        .map_err(|e| format!("Failed to restore backup: {}", e))?;

    Ok(())
}

/// Recursively restore files from a backup directory to the workspace.
fn restore_dir(workspace: &Path, current: &Path, backup_root: &Path) -> Result<(), String> {
    let entries = fs::read_dir(current)
        .map_err(|e| format!("Failed to read backup directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            restore_dir(workspace, &path, backup_root)?;
        } else if path.is_file() {
            // Compute relative path from backup root
            let relative = path
                .strip_prefix(backup_root)
                .map_err(|e| format!("Failed to compute relative path: {}", e))?;
            let dest = workspace.join(relative);

            // Ensure parent directory exists
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }

            fs::copy(&path, &dest)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }

    Ok(())
}

/// Remove old backups, keeping only the latest `MAX_BACKUPS`.
fn prune_old_backups(workspace: &Path) -> Result<(), String> {
    let backups_dir = workspace.join(BACKUPS_DIR);
    if !backups_dir.exists() {
        return Ok(());
    }

    let mut entries: Vec<PathBuf> = fs::read_dir(&backups_dir)
        .map_err(|e| format!("Failed to read backups directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.path())
        .collect();

    // Sort by name (timestamp string) ascending
    entries.sort();

    // Remove oldest entries beyond the limit
    while entries.len() > MAX_BACKUPS {
        if let Some(oldest) = entries.first() {
            fs::remove_dir_all(oldest)
                .map_err(|e| format!("Failed to remove old backup: {}", e))?;
        }
        entries.remove(0);
    }

    Ok(())
}

/// List all available backup IDs.
pub fn list_backups(workspace: &Path) -> Result<Vec<String>, String> {
    let backups_dir = workspace.join(BACKUPS_DIR);
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }

    let mut backups: Vec<String> = fs::read_dir(&backups_dir)
        .map_err(|e| format!("Failed to read backups directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|s| s.to_string())
        })
        .collect();

    backups.sort();
    Ok(backups)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backup_roundtrip() {
        let dir = std::env::temp_dir().join("deskspawn_test_backup");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // Create a test file
        let test_file = dir.join("test.txt");
        fs::write(&test_file, "hello world").unwrap();

        let backup_id = create_backup(&dir, &["test.txt".to_string()]).unwrap();

        // Modify the original
        fs::write(&test_file, "modified").unwrap();

        // Restore
        restore_backup(&dir, &backup_id).unwrap();

        let content = fs::read_to_string(&test_file).unwrap();
        assert_eq!(content, "hello world");

        let _ = fs::remove_dir_all(&dir);
    }
}
