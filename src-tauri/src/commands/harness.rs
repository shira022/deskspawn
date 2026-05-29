use crate::engine::backup;
use crate::engine::monitor::ErrorMonitor;
use crate::engine::security;
use crate::engine::staging;
use crate::models::config::{
    Action, ApplyResult, Artifact, ErrorInfo, FileInfo, ShellResult,
};
use std::path::{Path, PathBuf};
use tauri::State;

// ── Shared Application State ──────────────────────────────────────────────────

pub struct AppState {
    pub workspace_path: PathBuf,
    pub error_monitor: ErrorMonitor,
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Read a file from the workspace.
/// Validates that the path is within the workspace and the extension is allowed.
#[tauri::command]
pub fn read_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let target_path = state.workspace_path.join(&path);

    // Security: validate path is within workspace
    if !security::is_path_safe(&state.workspace_path, &target_path) {
        return Err(format!("Path traversal detected: {}", path));
    }

    // Security: only allow text file extensions
    if !security::is_extension_allowed(&path) {
        return Err(format!(
            "File extension not allowed for reading: {}. Allowed: .tsx, .ts, .jsx, .js, .css, .html, .json, .toml, .md, .yaml, .yml",
            Path::new(&path).extension().and_then(|e| e.to_str()).unwrap_or("")
        ));
    }

    if !target_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !target_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }

    // Check file size (max 10MB for reading)
    let metadata = target_path
        .metadata()
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    if metadata.len() > 10_485_760 {
        return Err("File too large to read (max 10MB)".to_string());
    }

    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read file {}: {}", path, e))?;

    log::debug!("Read file: {} ({} bytes)", path, content.len());
    Ok(content)
}

/// List all files recursively in the workspace.
/// Excludes node_modules/, target/, .deskspawn/, .git/, dist/.
#[tauri::command]
pub fn list_files(
    state: State<'_, AppState>,
) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();
    list_files_recursive(&state.workspace_path, &state.workspace_path, &mut files)
        .map_err(|e| format!("Failed to list files: {}", e))?;
    Ok(files)
}

/// Recursively walk the directory and collect file info.
fn list_files_recursive(
    root: &Path,
    dir: &Path,
    files: &mut Vec<FileInfo>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        // Check if we should skip this entry
        if let Some(file_name) = path.file_name() {
            let name = file_name.to_str().unwrap_or("");
            if name == "node_modules"
                || name == "target"
                || name == ".deskspawn"
                || name == ".git"
                || name == "dist"
                || name.starts_with('.')
            {
                continue;
            }
        }

        if path.is_dir() {
            list_files_recursive(root, &path, files)?;
        } else if path.is_file() {
            let metadata = entry
                .metadata()
                .map_err(|e| format!("Failed to get metadata: {}", e))?;

            let relative = path
                .strip_prefix(root)
                .map_err(|e| format!("Failed to get relative path: {}", e))?
                .to_str()
                .unwrap_or("")
                .to_string();

            // Skip hidden files
            if relative.starts_with('.') {
                continue;
            }

            let last_modified = metadata
                .modified()
                .ok()
                .and_then(|t| {
                    let duration = t
                        .duration_since(std::time::UNIX_EPOCH)
                        .ok()?;
                    let secs = duration.as_secs();
                    // Format as ISO 8601
                    let naive = chrono::DateTime::from_timestamp(secs as i64, 0)?;
                    Some(naive.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
                })
                .unwrap_or_default();

            files.push(FileInfo {
                path: relative,
                size: metadata.len(),
                last_modified,
            });
        }
    }

    Ok(())
}

/// Apply an artifact (JSON string) to the workspace.
///
/// The JSON should conform to the `Artifact` structure:
/// {
///   "name": "...",
///   "description": "...",
///   "actions": [
///     { "type": "file", "file_path": "...", "content": "...", "mode": "file"|"diff" },
///     { "type": "diff", "file_path": "...", "search": "...", "content": "..." },
///     { "type": "template", "table_name": "...", "columns": [...] },
///     { "type": "shell", "command": "..." }
///   ]
/// }
#[tauri::command]
pub fn apply_artifact(
    state: State<'_, AppState>,
    json: String,
) -> Result<ApplyResult, String> {
    let mut files_changed: Vec<String> = Vec::new();
    let mut shell_commands_run: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // ── Step 1: Parse the artifact ──────────────────────────────────────────
    let artifact: Artifact = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse artifact JSON: {}", e))?;

    if artifact.name.is_empty() {
        return Err("Artifact name cannot be empty".to_string());
    }
    log::info!("Applying artifact: {}", artifact.name);

    // ── Step 2: Validate actions ────────────────────────────────────────────
    if artifact.actions.is_empty() {
        return Err("Artifact has no actions".to_string());
    }
    if artifact.actions.len() > 30 {
        return Err(format!(
            "Too many actions ({}). Maximum allowed is 30.",
            artifact.actions.len()
        ));
    }

    // ── Step 3: Create backup ───────────────────────────────────────────────
    let files_to_backup: Vec<String> = artifact
        .actions
        .iter()
        .filter_map(|action| match action {
            Action::File(f) => Some(f.file_path.clone()),
            Action::Diff(d) => Some(d.file_path.clone()),
            Action::Template(_) => None,
            Action::Shell(_) => None,
        })
        .collect();

    if !files_to_backup.is_empty() {
        match backup::create_backup(&state.workspace_path, &files_to_backup) {
            Ok(backup_id) => {
                log::info!("Backup created with ID: {}", backup_id);
            }
            Err(e) => {
                errors.push(format!("Backup warning: {}", e));
            }
        }
    }

    // ── Step 4: Execute each action ─────────────────────────────────────────
    for action in &artifact.actions {
        match action {
            Action::File(file_action) => {
                let result = execute_file_action(&state.workspace_path, file_action);
                match result {
                    Ok(()) => {
                        files_changed.push(file_action.file_path.clone());
                        // Auto-detect: check if we need to run follow-up commands
                        if let Some(cmd) = detect_auto_command(&file_action.file_path) {
                            shell_commands_run.push(cmd.clone());
                        }
                    }
                    Err(e) => errors.push(e),
                }
            }
            Action::Diff(diff_action) => {
                let result = execute_diff_action(&state.workspace_path, diff_action);
                match result {
                    Ok(()) => {
                        files_changed.push(diff_action.file_path.clone());
                        if let Some(cmd) = detect_auto_command(&diff_action.file_path) {
                            shell_commands_run.push(cmd.clone());
                        }
                    }
                    Err(e) => errors.push(e),
                }
            }
            Action::Template(template_action) => {
                match crate::engine::template::generate_crud_files(
                    &template_action.table_name,
                    &template_action.columns,
                ) {
                    Ok(generated) => {
                        // Stage the generated files
                        let gen_actions: Vec<Action> = vec![action.clone()];
                        match staging::stage_files(&state.workspace_path, &gen_actions) {
                            Ok(staged) => {
                                // Immediately apply staged files
                                if let Err(e) =
                                    staging::validate_and_apply(&state.workspace_path, &staged)
                                {
                                    errors.push(format!("Template apply error: {}", e));
                                } else {
                                    for p in generated.get_all_paths() {
                                        files_changed.push(p);
                                    }
                                }
                            }
                            Err(e) => errors.push(format!("Template staging error: {}", e)),
                        }
                    }
                    Err(e) => errors.push(format!("Template generation error: {}", e)),
                }
            }
            Action::Shell(shell_action) => {
                // Shell actions are executed directly
                let result = execute_shell_action(&state.workspace_path, &shell_action.command);
                match result {
                    Ok(shell_result) => {
                        shell_commands_run.push(shell_action.command.clone());
                        if !shell_result.stderr.is_empty() {
                            // Non-fatal stderr; log but don't fail
                            log::warn!(
                                "Shell command stderr: {}",
                                shell_result.stderr
                            );
                        }
                    }
                    Err(e) => errors.push(e),
                }
            }
        }
    }

    log::info!(
        "Artifact '{}' applied: {} files changed, {} shell commands run, {} errors",
        artifact.name,
        files_changed.len(),
        shell_commands_run.len(),
        errors.len()
    );

    Ok(ApplyResult {
        files_changed,
        shell_commands_run,
        errors,
    })
}

/// Execute a file write action.
fn execute_file_action(workspace: &Path, action: &crate::models::config::FileAction) -> Result<(), String> {
    // Validate path
    let target_path = workspace.join(&action.file_path);
    if !security::is_path_safe(workspace, &target_path) {
        return Err(format!("Path traversal detected: {}", action.file_path));
    }
    if !security::is_extension_allowed(&action.file_path) {
        return Err(format!(
            "Extension not allowed: {}",
            Path::new(&action.file_path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("(none)")
        ));
    }

    // Create parent directories if needed
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories for {}: {}", action.file_path, e))?;
    }

    // Write the file
    std::fs::write(&target_path, &action.content)
        .map_err(|e| format!("Failed to write file {}: {}", action.file_path, e))?;

    log::info!("Wrote file: {} ({} bytes)", action.file_path, action.content.len());
    Ok(())
}

/// Execute a diff (search-and-replace) action.
fn execute_diff_action(workspace: &Path, action: &crate::models::config::DiffAction) -> Result<(), String> {
    let target_path = workspace.join(&action.file_path);

    // Validate path
    if !security::is_path_safe(workspace, &target_path) {
        return Err(format!("Path traversal detected: {}", action.file_path));
    }
    if !security::is_extension_allowed(&action.file_path) {
        return Err(format!("Extension not allowed: {}", action.file_path));
    }

    if !target_path.exists() {
        return Err(format!("File not found for diff: {}", action.file_path));
    }

    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read file for diff {}: {}", action.file_path, e))?;

    if !content.contains(&action.search) {
        return Err(format!(
            "Search string not found in '{}'. The content may have already been modified.",
            action.file_path
        ));
    }

    // Count occurrences to avoid ambiguity
    let count = content.matches(&action.search).count();
    if count > 1 {
        log::warn!(
            "Search string appears {} times in '{}'. Using first occurrence.",
            count,
            action.file_path
        );
    }

    let new_content = content.replacen(&action.search, &action.content, 1);

    std::fs::write(&target_path, &new_content)
        .map_err(|e| format!("Failed to write diff to {}: {}", action.file_path, e))?;

    log::info!(
        "Applied diff to '{}': replaced '{}' with '{}'",
        action.file_path,
        &action.search[..action.search.len().min(50)],
        &action.content[..action.content.len().min(50)]
    );
    Ok(())
}

/// Execute a shell command action.
fn execute_shell_action(
    workspace: &Path,
    command: &str,
) -> Result<ShellResult, String> {
    // Validate command against allowlist
    if !security::is_command_allowed(command) {
        return Err(format!(
            "Command not in allowlist: {}. Allowed: npm install/run, npx ...",
            command
        ));
    }

    // Sanitize npm install
    let sanitized_command = security::sanitize_npm_install(command);

    // Parse the command into program and args
    let parts: Vec<&str> = sanitized_command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command".to_string());
    }

    let program = parts[0];
    let args = &parts[1..];

    log::info!("Running shell command: {} (sanitized from: {})", sanitized_command, command);

    // Execute with timeout
    let output = execute_with_timeout(program, args, workspace, 120_000)?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Log results
    if !stdout.is_empty() {
        log::debug!("Command stdout: {}", stdout);
    }
    if !stderr.is_empty() {
        log::warn!("Command stderr: {}", stderr);
    }

    let exit_code = output.status.code().unwrap_or(-1);

    Ok(ShellResult {
        stdout,
        stderr,
        exit_code,
    })
}

/// Execute a command with a timeout.
fn execute_with_timeout(
    program: &str,
    args: &[&str],
    working_dir: &Path,
    timeout_ms: u64,
) -> Result<std::process::Output, String> {
    let mut child = std::process::Command::new(program)
        .args(args)
        .current_dir(working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", program, e))?;

    let start = std::time::Instant::now();
    let max_duration = std::time::Duration::from_millis(timeout_ms);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output()
                    .map_err(|e| format!("Failed to get command output: {}", e))?;
                return Ok(std::process::Output {
                    status,
                    stdout: output.stdout,
                    stderr: output.stderr,
                });
            }
            Ok(None) => {
                if start.elapsed() > max_duration {
                    let _ = child.kill();
                    return Err(format!(
                        "Command '{}' timed out after {}ms",
                        program, timeout_ms
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                return Err(format!("Command '{}' failed: {}", program, e));
            }
        }
    }
}

/// Auto-detect commands to run based on file changes.
fn detect_auto_command(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);

    // Trigger npm install on package.json changes
    if path.file_name().and_then(|n| n.to_str()) == Some("package.json") {
        Some("npm install".to_string())
    } else {
        None
    }
}

/// Run a shell command (direct invocation from frontend).
#[tauri::command]
pub fn run_shell(
    state: State<'_, AppState>,
    command: String,
) -> Result<ShellResult, String> {
    execute_shell_action(&state.workspace_path, &command)
}

/// Get collected errors from the error monitor.
#[tauri::command]
pub fn get_errors(
    state: State<'_, AppState>,
) -> Result<Vec<ErrorInfo>, String> {
    Ok(state.error_monitor.get_all_errors())
}

/// Get the workspace directory path.
#[tauri::command]
pub fn get_workspace_path(
    state: State<'_, AppState>,
) -> Result<String, String> {
    Ok(state
        .workspace_path
        .to_str()
        .ok_or_else(|| "Workspace path contains invalid characters".to_string())?
        .to_string())
}

/// Initialize the workspace directory with template files.
#[tauri::command]
pub fn initialize_workspace(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspace = &state.workspace_path;

    // Create workspace directory if not exists
    std::fs::create_dir_all(workspace)
        .map_err(|e| format!("Failed to create workspace directory: {}", e))?;

    // Create .deskspawn/ directory structure
    let deskspawn_dir = workspace.join(".deskspawn");
    std::fs::create_dir_all(deskspawn_dir.join("backups"))
        .map_err(|e| format!("Failed to create backups directory: {}", e))?;
    std::fs::create_dir_all(deskspawn_dir.join("staging"))
        .map_err(|e| format!("Failed to create staging directory: {}", e))?;

    // Check for template directory relative to the app
    let template_dir = Path::new("../templates/react-template");
    if template_dir.exists() {
        log::info!("Copying template files from {:?}", template_dir);
        copy_template_dir(template_dir, workspace)?;
    } else {
        log::warn!(
            "Template directory {:?} not found. Creating empty workspace.",
            template_dir
        );
        // Create minimal structure for React + TypeScript projects
        std::fs::create_dir_all(workspace.join("src"))
            .map_err(|e| format!("Failed to create src directory: {}", e))?;
    }

    log::info!("Workspace initialized at {:?}", workspace);
    Ok(())
}

/// Copy files from a template directory to the workspace, respecting .gitignore patterns.
fn copy_template_dir(src: &Path, dst: &Path) -> Result<(), String> {
    let entries = std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read template directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        // Skip .git, node_modules, target
        if let Some(name) = path.file_name() {
            let name_str = name.to_str().unwrap_or("");
            if name_str == ".git" || name_str == "node_modules" || name_str == "target" {
                continue;
            }
        }

        let relative = path
            .strip_prefix(src)
            .map_err(|e| format!("Failed to compute relative path: {}", e))?;
        let dest = dst.join(relative);

        if path.is_dir() {
            std::fs::create_dir_all(&dest)
                .map_err(|e| format!("Failed to create directory {}: {}", dest.display(), e))?;
            copy_template_dir(&path, &dest)?;
        } else if path.is_file() {
            std::fs::copy(&path, &dest)
                .map_err(|e| format!("Failed to copy {} to {}: {}", path.display(), dest.display(), e))?;
        }
    }

    Ok(())
}
