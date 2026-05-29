use crate::engine::security;
use crate::models::config::{ApplyResult, ShellAction, ShellResult, FileInfo};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tiny_http::{Header, Method, Response, Server, StatusCode};

// ── Response type alias ─────────────────────────────────────────────────────────

/// Concrete response type to avoid `impl Read` opaque-type issues.
type HttpResp = Response<Box<dyn Read + Send>>;

// ── Request/Response types ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ReadFileRequest {
    path: String,
}

#[derive(Serialize)]
struct ReadFileResponse {
    content: String,
}

#[derive(Serialize)]
struct ListFilesResponse {
    files: Vec<FileInfo>,
}

#[derive(Deserialize)]
struct RunShellRequest {
    command: String,
}

#[derive(Deserialize)]
struct UpdateWorkspaceRequest {
    path: String,
}

#[derive(Serialize)]
struct UpdateWorkspaceResponse {
    success: bool,
}

#[derive(Deserialize)]
struct ApplyArtifactRequest {
    #[serde(default)]
    name: String,
    actions: Vec<SecurityAction>,
}

/// Simplified action for the security server (no Template actions).
#[derive(Deserialize)]
#[serde(tag = "type")]
enum SecurityAction {
    #[serde(rename = "file")]
    File(SecurityFileAction),
    #[serde(rename = "diff")]
    Diff(SecurityDiffAction),
    #[serde(rename = "shell")]
    Shell(ShellAction),
}

#[derive(Deserialize)]
struct SecurityFileAction {
    #[serde(default = "default_file_path")]
    file_path: String,
    #[serde(default)]
    content: String,
    #[serde(default = "default_file_mode")]
    mode: String,
}

#[derive(Deserialize)]
struct SecurityDiffAction {
    #[serde(default = "default_file_path")]
    file_path: String,
    #[serde(default)]
    search: String,
    #[serde(default)]
    content: String,
}

fn default_file_path() -> String { String::new() }
fn default_file_mode() -> String { "file".to_string() }

// ── Start the security server ───────────────────────────────────────────────────

/// Start the security HTTP server on a random localhost port.
/// Returns the port number.
pub fn start(workspace_path: PathBuf) -> u16 {
    let server = Server::http("127.0.0.1:0")
        .expect("Failed to start security HTTP server");
    let port = server.server_addr()
        .to_ip()
        .expect("Failed to get security server port")
        .port();

    let workspace = Arc::new(Mutex::new(workspace_path));

    log::info!(
        "Security server listening on 127.0.0.1:{}",
        port
    );

    let ws = workspace.clone();
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let ws = ws.clone();
            std::thread::spawn(move || {
                handle_request(request, &ws);
            });
        }
    });

    port
}

// ── Request routing ─────────────────────────────────────────────────────────────

fn handle_request(mut request: tiny_http::Request, workspace: &Arc<Mutex<PathBuf>>) {
    // Read body first (requires mutable access)
    let mut body = String::new();
    let body_read_ok = request.as_reader().read_to_string(&mut body).is_ok();

    let url = request.url().to_string();
    let method = request.method();

    if !body_read_ok {
        let _ = request.respond(error(StatusCode(400), "Failed to read body"));
        return;
    }

    let ws = match workspace.lock() {
        Ok(g) => g.clone(),
        Err(_) => {
            let _ = request.respond(error(StatusCode(500), "Internal server error"));
            return;
        }
    };

    let response = match (method, url.as_str()) {
        (&Method::Post, "/api/read-file") => handle_read_file(&ws, &body),
        (&Method::Post, "/api/list-files") => handle_list_files(&ws),
        (&Method::Post, "/api/apply-artifact") => handle_apply_artifact(&ws, &body),
        (&Method::Post, "/api/run-shell") => handle_run_shell(&ws, &body),
        (&Method::Post, "/api/update-workspace") => handle_update_workspace(workspace, &body),
        _ => error(StatusCode(404), "Not found"),
    };

    let _ = request.respond(response);
}

// ── Endpoint handlers ───────────────────────────────────────────────────────────

fn handle_read_file(workspace: &Path, body: &str) -> HttpResp {
    let req: ReadFileRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return error(StatusCode(400), &format!("Invalid JSON: {}", e)),
    };

    let target_path = workspace.join(&req.path);

    if !security::is_path_safe(workspace, &target_path) {
        return error(StatusCode(403), &format!("Path traversal detected: {}", req.path));
    }
    if !security::is_extension_allowed(&req.path) {
        return error(StatusCode(403), &format!("Extension not allowed: {}", req.path));
    }

    if !target_path.exists() {
        return error(StatusCode(404), &format!("File not found: {}", req.path));
    }
    if !target_path.is_file() {
        return error(StatusCode(400), &format!("Not a file: {}", req.path));
    }

    // Size check (max 10MB)
    match target_path.metadata() {
        Ok(meta) if meta.len() > 10_485_760 => {
            return error(StatusCode(413), "File too large (max 10MB)");
        }
        Err(e) => {
            return error(StatusCode(500), &format!("Failed to read metadata: {}", e));
        }
        _ => {}
    }

    match std::fs::read_to_string(&target_path) {
        Ok(content) => ok_json(&ReadFileResponse { content }),
        Err(e) => error(StatusCode(500), &format!("Failed to read file: {}", e)),
    }
}

fn handle_list_files(workspace: &Path) -> HttpResp {
    let mut files = Vec::new();
    if let Err(e) = list_files_recursive(workspace, workspace, &mut files) {
        return error(StatusCode(500), &e);
    }
    ok_json(&ListFilesResponse { files })
}

fn handle_apply_artifact(workspace: &Path, body: &str) -> HttpResp {
    let req: ApplyArtifactRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return error(StatusCode(400), &format!("Invalid artifact JSON: {}", e)),
    };

    if req.actions.len() > 30 {
        return error(StatusCode(400), "Too many actions (max 30)");
    }

    let mut result = ApplyResult {
        files_changed: Vec::new(),
        shell_commands_run: Vec::new(),
        errors: Vec::new(),
    };

    for action in &req.actions {
        match action {
            SecurityAction::File(fa) => {
                match execute_file_action(workspace, fa) {
                    Ok(()) => result.files_changed.push(fa.file_path.clone()),
                    Err(e) => result.errors.push(e),
                }
            }
            SecurityAction::Diff(da) => {
                match execute_diff_action(workspace, da) {
                    Ok(()) => result.files_changed.push(da.file_path.clone()),
                    Err(e) => result.errors.push(e),
                }
            }
            SecurityAction::Shell(sa) => {
                match execute_shell_action(workspace, &sa.command) {
                    Ok(sr) => {
                        result.shell_commands_run.push(sa.command.clone());
                        if !sr.stderr.is_empty() {
                            log::warn!("Shell command stderr: {}", sr.stderr);
                        }
                    }
                    Err(e) => result.errors.push(e),
                }
            }
        }
    }

    ok_json(&result)
}

fn handle_run_shell(workspace: &Path, body: &str) -> HttpResp {
    let req: RunShellRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return error(StatusCode(400), &format!("Invalid JSON: {}", e)),
    };

    match execute_shell_action(workspace, &req.command) {
        Ok(result) => ok_json(&result),
        Err(e) => error(StatusCode(403), &e),
    }
}

fn handle_update_workspace(
    workspace_lock: &Arc<Mutex<PathBuf>>,
    body: &str,
) -> HttpResp {
    let req: UpdateWorkspaceRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return error(StatusCode(400), &format!("Invalid JSON: {}", e)),
    };

    let new_path = PathBuf::from(&req.path);
    if !new_path.is_absolute() {
        return error(StatusCode(400), "Workspace path must be absolute");
    }
    if !new_path.exists() || !new_path.is_dir() {
        return error(StatusCode(400), "Workspace path does not exist or is not a directory");
    }

    match workspace_lock.lock() {
        Ok(mut ws) => {
            *ws = new_path;
            log::info!("Security server workspace updated to: {:?}", ws);
            ok_json(&UpdateWorkspaceResponse { success: true })
        }
        Err(_) => error(StatusCode(500), "Internal server error"),
    }
}

// ── Action executors ────────────────────────────────────────────────────────────

fn execute_file_action(workspace: &Path, action: &SecurityFileAction) -> Result<(), String> {
    let target_path = workspace.join(&action.file_path);
    if !security::is_path_safe(workspace, &target_path) {
        return Err(format!("Path traversal detected: {}", action.file_path));
    }
    if !security::is_extension_allowed(&action.file_path) {
        return Err(format!("Extension not allowed: {}", action.file_path));
    }

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    std::fs::write(&target_path, &action.content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    log::debug!("Security server wrote file: {} ({} bytes)", action.file_path, action.content.len());
    Ok(())
}

fn execute_diff_action(workspace: &Path, action: &SecurityDiffAction) -> Result<(), String> {
    let target_path = workspace.join(&action.file_path);
    if !security::is_path_safe(workspace, &target_path) {
        return Err(format!("Path traversal detected: {}", action.file_path));
    }
    if !security::is_extension_allowed(&action.file_path) {
        return Err(format!("Extension not allowed: {}", action.file_path));
    }

    if !target_path.exists() {
        return Err(format!("File not found: {}", action.file_path));
    }

    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    if !content.contains(&action.search) {
        return Err(format!("Search string not found in '{}'", action.file_path));
    }

    let count = content.matches(&action.search).count();
    if count > 1 {
        log::warn!("Search string appears {} times in '{}'", count, action.file_path);
    }

    let new_content = content.replacen(&action.search, &action.content, 1);
    std::fs::write(&target_path, &new_content)
        .map_err(|e| format!("Failed to write diff: {}", e))?;

    log::debug!("Security server applied diff to: {}", action.file_path);
    Ok(())
}

fn execute_shell_action(workspace: &Path, command: &str) -> Result<ShellResult, String> {
    if !security::is_command_allowed(command) {
        return Err(format!("Command not allowed: {}", command));
    }

    let sanitized = security::sanitize_npm_install(command);
    let parts: Vec<&str> = sanitized.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command".to_string());
    }

    let program = parts[0];
    let args = &parts[1..];

    log::info!("Security server running: {} (sanitized from: {})", sanitized, command);

    let output = execute_with_timeout(program, args, workspace, 120_000)?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if !stdout.is_empty() {
        log::debug!("Command stdout: {}", stdout);
    }
    if !stderr.is_empty() {
        log::warn!("Command stderr: {}", stderr);
    }

    Ok(ShellResult {
        stdout,
        stderr,
        exit_code,
    })
}

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

    let start = Instant::now();
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
                    return Err(format!("Command '{}' timed out after {}ms", program, timeout_ms));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                return Err(format!("Command '{}' failed: {}", program, e));
            }
        }
    }
}

// ── File listing helpers ────────────────────────────────────────────────────────

fn list_files_recursive(
    root: &Path,
    dir: &Path,
    files: &mut Vec<FileInfo>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

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
            let metadata = entry.metadata()
                .map_err(|e| format!("Failed to get metadata: {}", e))?;

            let relative = path.strip_prefix(root)
                .map_err(|e| format!("Failed to get relative path: {}", e))?
                .to_str().unwrap_or("").to_string();

            if relative.starts_with('.') {
                continue;
            }

            let last_modified = metadata.modified()
                .ok()
                .and_then(|t| {
                    let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                    let secs = duration.as_secs();
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

// ── HTTP response helpers ───────────────────────────────────────────────────────

fn content_type_header() -> Header {
    "Content-Type: application/json"
        .parse::<Header>()
        .expect("Invalid header")
}

fn ok_json<T: serde::Serialize>(data: &T) -> HttpResp {
    let json = serde_json::to_string(data).unwrap_or_else(|_| "{}".to_string());
    let bytes = json.into_bytes();
    let len = bytes.len();
    let reader: Box<dyn Read + Send> = Box::new(Cursor::new(bytes));
    Response::new(
        StatusCode(200),
        vec![content_type_header()],
        reader,
        Some(len),
        None,
    )
}

fn error(status: StatusCode, msg: &str) -> HttpResp {
    let escaped = msg.replace('\\', "\\\\").replace('"', "\\\"");
    let json = format!("{{\"error\":\"{}\"}}", escaped);
    let bytes = json.into_bytes();
    let len = bytes.len();
    let reader: Box<dyn Read + Send> = Box::new(Cursor::new(bytes));
    Response::new(
        status,
        vec![content_type_header()],
        reader,
        Some(len),
        None,
    )
}
