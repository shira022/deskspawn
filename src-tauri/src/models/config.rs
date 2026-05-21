use serde::{Deserialize, Serialize};

// ── AI Configuration ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub custom_endpoint: Option<String>,
    pub api_version: Option<String>,
    pub temperature: f64,
    pub max_tokens: Option<u32>,
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
    #[serde(rename = "template")]
    Template(TemplateAction),
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
pub struct TemplateAction {
    pub table_name: String,
    pub columns: Vec<TemplateColumn>,
    #[serde(default)]
    pub operations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateColumn {
    pub name: String,
    pub sql_type: String,
    pub rust_type: String,
    pub ts_type: String,
    #[serde(default)]
    pub nullable: bool,
    #[serde(default)]
    pub primary_key: bool,
    #[serde(default)]
    pub unique: bool,
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub references: Option<String>,
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

// ── Column for template generation ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    pub name: String,
    pub sql_type: String,
    pub rust_type: String,
    pub ts_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub unique: bool,
    pub default: Option<String>,
    pub references: Option<String>,
}
