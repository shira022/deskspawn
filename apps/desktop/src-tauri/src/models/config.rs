use serde::{Deserialize, Serialize};

/// Default storage method when none is specified (backward compat).
fn default_storage_method() -> String {
    "keychain".to_string()
}

// ── AI Configuration ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: String,
    #[serde(alias = "api_key")]
    pub api_key: String,
    pub model: String,
    #[serde(alias = "custom_endpoint")]
    pub custom_endpoint: Option<String>,
    #[serde(alias = "api_version")]
    pub api_version: Option<String>,
    pub temperature: f64,
    #[serde(alias = "max_tokens")]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub max_steps: Option<u32>,
    /// True when the API key is stored (keychain or file).
    /// The frontend uses this flag instead of the actual key value.
    #[serde(default)]
    pub api_key_configured: bool,
    /// Storage method for the API key: "keychain" (OS keychain) or "file"
    /// (encrypted credentials.json in config directory).
    #[serde(default = "default_storage_method")]
    pub storage_method: String,
}

// ── Environment Check ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvCheckItem {
    pub name: String,
    pub description: String,
    pub check_command: String,
    pub status: String,
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winget_package: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_mb: Option<u32>,
}

/// Result of winget availability check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WingetStatus {
    pub available: bool,
    pub version: Option<String>,
    pub message: String,
}

/// Progress event emitted during winget installation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupProgress {
    pub package: String,
    pub stage: String,       // "starting" | "downloading" | "installing" | "complete" | "error"
    pub progress_percent: u8,
    pub message: String,
}

// ── File Info ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub last_modified: String,
}

// ── Actions ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Action {
    #[serde(rename = "file")]
    File(FileAction),
    #[serde(rename = "diff")]
    Diff(DiffAction),
    #[serde(rename = "shell")]
    Shell(ShellAction),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAction {
    pub file_path: String,
    pub content: String,
    #[serde(default = "default_file_mode")]
    pub mode: String,
}

fn default_file_mode() -> String {
    "file".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffAction {
    pub file_path: String,
    pub search: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellAction {
    pub command: String,
}

// ── Artifact ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    pub name: String,
    pub description: Option<String>,
    pub actions: Vec<Action>,
}

// ── Results ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyResult {
    pub files_changed: Vec<String>,
    pub shell_commands_run: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorInfo {
    pub error_type: String,
    pub message: String,
    pub file_path: Option<String>,
    pub line: Option<u32>,
}

// ── Spawn Config ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnConfig {
    pub app_name: String,
    pub version: String,
    pub window_title: String,
}


