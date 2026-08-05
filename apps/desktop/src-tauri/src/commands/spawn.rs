use crate::models::config::{ApplyResult, SpawnConfig};
use std::path::Path;
use std::process::Command;
use tauri::Runtime;

/// Spawn a full Tauri build with the given configuration.
///
/// 1. Pre-flight checks (TypeScript type-check, cargo check, sqlx migrate)
/// 2. Update tauri.conf.json with app name, version, window title
/// 3. Run `npm run tauri build`
/// 4. Return result with path to output binary
#[tauri::command]
pub async fn spawn_build<R: Runtime>(
    _app_handle: tauri::AppHandle<R>,
    config: SpawnConfig,
) -> Result<ApplyResult, String> {
    let mut files_changed = Vec::new();
    let mut shell_commands_run = Vec::new();
    let mut errors = Vec::new();

    // Determine workspace path (same as the app's resource dir)
    let workspace = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?;

    // ── Step 1: Pre-flight checks ──────────────────────────────────────────
    log::info!("Running pre-flight checks for spawn build...");

    // TypeScript type-check
    match run_command("npm", &["run", "type-check"], &workspace, 120_000) {
        Ok(output) => {
            shell_commands_run.push("npm run type-check".to_string());
            if !output.status.success() {
                errors.push(format!(
                    "TypeScript type-check failed:\n{}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
        }
        Err(_e) => {
            // type-check script may not exist; try tsc --noEmit directly
            match run_command("npx", &["tsc", "--noEmit"], &workspace, 120_000) {
                Ok(tsc_output) => {
                    shell_commands_run.push("npx tsc --noEmit".to_string());
                    if !tsc_output.status.success() {
                        errors.push(format!(
                            "TypeScript check failed:\n{}",
                            String::from_utf8_lossy(&tsc_output.stderr)
                        ));
                    }
                }
                Err(e2) => {
                    errors.push(format!("TypeScript check error: {}", e2));
                }
            }
        }
    }

    // Cargo check
    let tauri_dir = workspace.join("src-tauri");
    if tauri_dir.exists() {
        match run_command("cargo", &["check"], &tauri_dir, 300_000) {
            Ok(cargo_output) => {
                shell_commands_run.push("cargo check".to_string());
                if !cargo_output.status.success() {
                    errors.push(format!(
                        "Cargo check failed:\n{}",
                        String::from_utf8_lossy(&cargo_output.stderr)
                    ));
                }
            }
            Err(e) => {
                errors.push(format!("Cargo check error: {}", e));
            }
        }
    }

    // Sqlx migrate (check if migrations exist)
    let migrations_dir = workspace.join("migrations");
    if migrations_dir.exists() {
        match run_command("sqlx", &["migrate", "run"], &workspace, 60_000) {
            Ok(sqlx_output) => {
                shell_commands_run.push("sqlx migrate run".to_string());
                if !sqlx_output.status.success() {
                    errors.push(format!(
                        "Sqlx migrate failed:\n{}",
                        String::from_utf8_lossy(&sqlx_output.stderr)
                    ));
                }
            }
            Err(e) => {
                errors.push(format!("Sqlx migrate error: {}", e));
            }
        }
    }

    // ── Step 2: Update tauri.conf.json ─────────────────────────────────────
    let conf_path = tauri_dir.join("tauri.conf.json");
    if conf_path.exists() {
        let content = std::fs::read_to_string(&conf_path)
            .map_err(|e| format!("Failed to read tauri.conf.json: {}", e))?;

        let mut conf: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse tauri.conf.json: {}", e))?;

        // Update productName
        if let Some(obj) = conf.as_object_mut() {
            obj.insert(
                "productName".to_string(),
                serde_json::Value::String(config.app_name.clone()),
            );
            obj.insert(
                "version".to_string(),
                serde_json::Value::String(config.version.clone()),
            );
        }

        // Update window title
        if let Some(app) = conf.get_mut("app") {
            if let Some(windows) = app.get_mut("windows") {
                if let Some(windows_arr) = windows.as_array_mut() {
                    if let Some(first_window) = windows_arr.first_mut() {
                        if let Some(window_obj) = first_window.as_object_mut() {
                            window_obj.insert(
                                "title".to_string(),
                                serde_json::Value::String(config.window_title.clone()),
                            );
                        }
                    }
                }
            }
        }

        let new_content = serde_json::to_string_pretty(&conf)
            .map_err(|e| format!("Failed to serialize tauri.conf.json: {}", e))?;

        std::fs::write(&conf_path, &new_content)
            .map_err(|e| format!("Failed to write tauri.conf.json: {}", e))?;

        files_changed.push("src-tauri/tauri.conf.json".to_string());
    }

    // ── Step 3: Run tauri build ────────────────────────────────────────────
    log::info!("Running npm run tauri build...");
    match run_command("npm", &["run", "tauri", "build"], &workspace, 600_000) {
        Ok(build_output) => {
            shell_commands_run.push("npm run tauri build".to_string());
            if build_output.status.success() {
                let stdout = String::from_utf8_lossy(&build_output.stdout);
                log::info!("Build succeeded:\n{}", stdout);
            } else {
                let stderr = String::from_utf8_lossy(&build_output.stderr);
                errors.push(format!("Tauri build failed:\n{}", stderr));
            }
        }
        Err(e) => {
            errors.push(format!("Tauri build error: {}", e));
        }
    }

    Ok(ApplyResult {
        files_changed,
        shell_commands_run,
        errors,
    })
}

/// Run a command with args in a specific directory, with a timeout in ms.
fn run_command(
    program: &str,
    args: &[&str],
    working_dir: &Path,
    timeout_ms: u64,
) -> Result<std::process::Output, String> {
    let mut child = Command::new(program)
        .args(args)
        .current_dir(working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", program, e))?;

    // Wait with timeout
    let now = std::time::Instant::now();
    let max_wait = std::time::Duration::from_millis(timeout_ms);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().map_err(|e| format!("Failed to get output: {}", e))?;
                return Ok(std::process::Output {
                    status,
                    stdout: output.stdout,
                    stderr: output.stderr,
                });
            }
            Ok(None) => {
                if now.elapsed() > max_wait {
                    let _ = child.kill();
                    return Err(format!("Command '{}' timed out after {}ms", program, timeout_ms));
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                return Err(format!("Command '{}' failed: {}", program, e));
            }
        }
    }
}
