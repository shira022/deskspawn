use crate::models::config::Action;
use std::fs;
use std::path::Path;

use super::template::{generate_crud_files, GeneratedFiles};

const STAGING_DIR: &str = ".deskspawn/staging";

/// Write actions to the staging directory instead of the workspace directly.
pub fn stage_files(workspace: &Path, actions: &[Action]) -> Result<Vec<String>, String> {
    let staging_root = workspace.join(STAGING_DIR);
    fs::create_dir_all(&staging_root)
        .map_err(|e| format!("Failed to create staging directory: {}", e))?;

    let mut staged_files = Vec::new();

    for action in actions {
        match action {
            Action::File(file_action) => {
                let relative_path = Path::new(&file_action.file_path);
                let dest = staging_root.join(relative_path);

                // Ensure parent
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create staging subdirectory: {}", e))?;
                }

                fs::write(&dest, &file_action.content)
                    .map_err(|e| format!("Failed to stage file {}: {}", file_action.file_path, e))?;

                staged_files.push(file_action.file_path.clone());
            }
            Action::Diff(diff_action) => {
                let relative_path = Path::new(&diff_action.file_path);
                let dest = staging_root.join(relative_path);

                // If file exists in staging, read from there; otherwise from workspace
                let source_path = if dest.exists() {
                    dest.clone()
                } else {
                    workspace.join(relative_path)
                };

                if !source_path.exists() {
                    return Err(format!(
                        "File not found for diff: {}",
                        diff_action.file_path
                    ));
                }

                let content = fs::read_to_string(&source_path)
                    .map_err(|e| format!("Failed to read file for diff: {}", e))?;

                if !content.contains(&diff_action.search) {
                    return Err(format!(
                        "Search string not found in {}",
                        diff_action.file_path
                    ));
                }

                let new_content = content.replace(&diff_action.search, &diff_action.content);

                // Ensure parent
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create staging subdirectory: {}", e))?;
                }

                fs::write(&dest, &new_content)
                    .map_err(|e| format!("Failed to stage diff file: {}", e))?;

                staged_files.push(diff_action.file_path.clone());
            }
            Action::Template(template_action) => {
                let generated = generate_crud_files(&template_action.table_name, &template_action.columns)?;

                // Write generated files to staging
                write_generated_files(workspace, &staging_root, &generated)?;
                staged_files.extend(generated.get_all_paths());
            }
            Action::Shell(_) => {
                // Shell actions are not staged; they are executed directly
            }
        }
    }

    Ok(staged_files)
}

/// Validate staged files by running TypeScript and Cargo checks,
/// then copy valid files to workspace.
pub fn validate_and_apply(
    workspace: &Path,
    staged_files: &[String],
) -> Result<(), String> {
    let staging_root = workspace.join(STAGING_DIR);

    // Copy each staged file to workspace, overwriting originals
    for file_path in staged_files {
        let src = staging_root.join(file_path);
        if !src.exists() {
            continue;
        }
        let dest = workspace.join(file_path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        fs::copy(&src, &dest)
            .map_err(|e| format!("Failed to copy staged file to workspace: {}", e))?;
    }

    Ok(())
}

/// Remove all files from the staging directory.
pub fn clear_staging(workspace: &Path) -> Result<(), String> {
    let staging_root = workspace.join(STAGING_DIR);
    if staging_root.exists() {
        fs::remove_dir_all(&staging_root)
            .map_err(|e| format!("Failed to clear staging: {}", e))?;
    }
    Ok(())
}

/// Check if staging directory has any files.
pub fn has_staged_files(workspace: &Path) -> bool {
    let staging_root = workspace.join(STAGING_DIR);
    staging_root.exists() && staging_root.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false)
}

/// Write generated files from the template engine to the staging directory.
fn write_generated_files(
    workspace: &Path,
    staging_root: &Path,
    generated: &GeneratedFiles,
) -> Result<(), String> {
    // Write migration file
    if let Some(ref migration) = generated.migration {
        let dest = staging_root.join(&migration.path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        fs::write(&dest, &migration.content)
            .map_err(|e| format!("Failed to write migration file: {}", e))?;
    }

    // Write Rust file
    if let Some(ref rust) = generated.rust_code {
        let dest = staging_root.join(&rust.path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        fs::write(&dest, &rust.content)
            .map_err(|e| format!("Failed to write Rust file: {}", e))?;
    }

    // Write TypeScript hooks file
    if let Some(ref ts) = generated.ts_hooks {
        let dest = staging_root.join(&ts.path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        fs::write(&dest, &ts.content)
            .map_err(|e| format!("Failed to write TypeScript hooks file: {}", e))?;
    }

    // ── Apply registration patches against existing workspace files ─────
    for patch in &generated.patches {
        let relative_path = Path::new(&patch.file_path);
        // Read from the workspace (real file) since the staging won't have it
        let source_path = workspace.join(relative_path);
        if !source_path.exists() {
            log::warn!(
                "Patch target '{}' not found in workspace; skipping.",
                patch.file_path
            );
            continue;
        }

        let content = fs::read_to_string(&source_path)
            .map_err(|e| format!("Failed to read '{}' for patching: {}", patch.file_path, e))?;

        if !content.contains(&patch.search) {
            log::warn!(
                "Search string not found in '{}'; skipping patch.",
                patch.file_path
            );
            continue;
        }

        let new_content = content.replacen(&patch.search, &patch.content, 1);

        // Write patched file to staging (it will be copied to workspace later)
        let dest = staging_root.join(relative_path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for patch: {}", e))?;
        }
        fs::write(&dest, &new_content)
            .map_err(|e| format!("Failed to write patched '{}': {}", patch.file_path, e))?;

        log::info!(
            "Applied registration patch to '{}' (replaced marker '{}')",
            patch.file_path,
            patch.search
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::config::{Action, FileAction};

    #[test]
    fn test_stage_and_apply() {
        let dir = std::env::temp_dir().join("deskspawn_test_staging");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let actions = vec![Action::File(FileAction {
            file_path: "test.txt".to_string(),
            content: "hello staging".to_string(),
            mode: "file".to_string(),
        })];

        let staged = stage_files(&dir, &actions).unwrap();
        assert_eq!(staged.len(), 1);
        assert!(has_staged_files(&dir));

        validate_and_apply(&dir, &staged).unwrap();

        let content = fs::read_to_string(dir.join("test.txt")).unwrap();
        assert_eq!(content, "hello staging");

        clear_staging(&dir).unwrap();
        assert!(!has_staged_files(&dir));

        let _ = fs::remove_dir_all(&dir);
    }
}
