use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Default storage method when none is specified (backward compat).
fn default_storage_method() -> String {
    "keychain".to_string()
}

// ── Per-Provider Config (ADR: multi-provider settings in config.json) ─────────

/// Settings for a single provider, stored under `providers.<name>` in config.json.
/// Mirrors `StoredProviderConfig` in apps/web/src/lib/storage.ts.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub model: String,
    #[serde(default)]
    pub custom_endpoint: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub max_steps: Option<u32>,
}

// ── UI Settings (persisted to config.json on desktop) ─────────────────────────

fn default_theme() -> String {
    "system".to_string()
}
fn default_ui_font_size() -> u32 {
    14
}
fn default_code_font_size() -> u32 {
    13
}
fn default_language() -> String {
    "ja".to_string()
}
fn default_simple_mode() -> bool {
    true
}

/// UI settings (language, theme, font sizes, simple mode).
///
/// Desktop persists these to `config.json` (was WebView localStorage
/// `deskspawn_settings` — web-storage audit 2026-08-12 follow-up). The
/// frontend treats `None` (no `settings` key in config.json) as "first run /
/// language not chosen yet" and shows the language-select screen on desktop.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_ui_font_size")]
    pub ui_font_size: u32,
    #[serde(default = "default_code_font_size")]
    pub code_font_size: u32,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_simple_mode")]
    pub simple_mode: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            ui_font_size: default_ui_font_size(),
            code_font_size: default_code_font_size(),
            language: default_language(),
            simple_mode: default_simple_mode(),
        }
    }
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
    #[serde(default)]
    pub temperature: f64,
    #[serde(alias = "max_tokens")]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub max_steps: Option<u32>,
    /// Region for the current provider (stored per-provider in `providers` too).
    #[serde(default)]
    pub region: Option<String>,
    /// True when the API key is stored (keychain or file).
    /// The frontend uses this flag instead of the actual key value.
    #[serde(default)]
    pub api_key_configured: bool,
    /// Storage method for the API key: "keychain" (OS keychain) or "file"
    /// (encrypted credentials.json in config directory).
    #[serde(default = "default_storage_method")]
    pub storage_method: String,
    /// Per-provider settings map (multi-provider support). The flat fields
    /// above mirror the last-saved provider for backward compatibility.
    #[serde(default)]
    pub providers: HashMap<String, ProviderConfig>,
    /// The most recently used provider.
    #[serde(default)]
    pub last_provider: Option<String>,
    /// The currently open app (UI state persisted so the app reopens where
    /// the user left off — was WebView localStorage `deskspawn_current_app`).
    /// None の場合はシリアライズ時にキーごと除去する
    /// （save_current_app(null) で「current_app の除去」を実現、2026-08-27 監査指摘対応）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_app: Option<String>,
    /// UI settings (language/theme/font/simple mode). `None` = never saved
    /// yet (first run) — the desktop app shows the language-select screen.
    #[serde(default)]
    pub settings: Option<AppSettings>,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: String::new(),
            api_key: String::new(),
            model: String::new(),
            custom_endpoint: None,
            api_version: None,
            temperature: 0.0,
            max_tokens: None,
            max_steps: None,
            region: None,
            api_key_configured: false,
            storage_method: default_storage_method(),
            providers: HashMap::new(),
            last_provider: None,
            current_app: None,
            settings: None,
        }
    }
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_config_roundtrip_uses_camel_case_and_preserves_fields() {
        let mut providers = HashMap::new();
        providers.insert(
            "openai".to_string(),
            ProviderConfig {
                model: "gpt-4o".into(),
                custom_endpoint: Some("http://127.0.0.1:9999/v1".into()),
                region: None,
                max_steps: Some(15),
            },
        );
        let cfg = AiConfig {
            provider: "openai".into(),
            api_key: String::new(),
            model: "gpt-4o".into(),
            custom_endpoint: Some("http://127.0.0.1:9999/v1".into()),
            api_version: None,
            temperature: 0.7,
            max_tokens: Some(4096),
            max_steps: Some(15),
            region: None,
            api_key_configured: true,
            storage_method: "file".into(),
            providers: providers.clone(),
            last_provider: Some("openai".into()),
            current_app: Some("app-0123456789abcdef0123456789abcdef".into()),
            settings: Some(AppSettings::default()),
        };

        let json = serde_json::to_string(&cfg).unwrap();
        // camelCase でシリアライズされる（スネークケース・レガシー名が出ない）
        assert!(json.contains("\"apiKeyConfigured\""), "json: {json}");
        assert!(json.contains("\"storageMethod\""), "json: {json}");
        assert!(json.contains("\"customEndpoint\""), "json: {json}");
        assert!(json.contains("\"currentApp\""), "json: {json}");
        assert!(!json.contains("api_key"), "no legacy snake_case key: {json}");

        let back: AiConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.provider, "openai");
        assert_eq!(back.model, "gpt-4o");
        assert_eq!(back.temperature, 0.7);
        assert_eq!(back.max_tokens, Some(4096));
        assert_eq!(back.storage_method, "file");
        assert!(back.api_key_configured);
        assert_eq!(
            back.current_app.as_deref(),
            Some("app-0123456789abcdef0123456789abcdef")
        );
        assert_eq!(back.settings.as_ref().unwrap().language, "ja");
        assert_eq!(
            back.providers
                .get("openai")
                .unwrap()
                .custom_endpoint
                .as_deref(),
            Some("http://127.0.0.1:9999/v1")
        );
        assert_eq!(back.providers.get("openai").unwrap().max_steps, Some(15));
    }

    #[test]
    fn ai_config_rejects_invalid_json() {
        assert!(serde_json::from_str::<AiConfig>("{ not valid json").is_err());
        // 必須フィールドの型不一致（provider が数値）も拒否
        assert!(serde_json::from_str::<AiConfig>(r#"{"provider": 42}"#).is_err());
    }

    #[test]
    fn ai_config_applies_defaults_when_optional_fields_missing() {
        // 旧バージョンの config.json（version フィールド等の任意フィールド欠落・
        // api_key 平文アリ）でも必須フィールドがあればデフォルトでパースできる。
        let json = r#"{
            "provider": "openai",
            "api_key": "sk-legacy",
            "model": "gpt-4o"
        }"#;
        let cfg: AiConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.provider, "openai");
        assert_eq!(cfg.api_key, "sk-legacy");
        assert_eq!(cfg.temperature, 0.0);
        assert!(!cfg.api_key_configured);
        assert_eq!(cfg.storage_method, "keychain"); // default_storage_method
        assert!(cfg.custom_endpoint.is_none());
        assert!(cfg.max_tokens.is_none());
        assert!(cfg.current_app.is_none());
        assert!(cfg.settings.is_none());
        assert!(cfg.providers.is_empty());
    }

    #[test]
    fn ai_config_ignores_unknown_version_field() {
        // 将来 config.json に "version" 等の未知フィールドが追加されても
        // 無視してパースできる（前方互換）。必須フィールド（api_key）は含める。
        let json = r#"{"provider":"anthropic","api_key":"sk-x","model":"claude","version":2}"#;
        let cfg: AiConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.provider, "anthropic");
        assert_eq!(cfg.model, "claude");
    }

    #[test]
    fn current_app_none_is_not_serialized() {
        // save_current_app(None) で config.json から current_app キーが除去される
        // （skip_serializing_if、2026-08-27 監査指摘対応）。
        let cfg = AiConfig {
            current_app: None,
            ..AiConfig::default()
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("currentApp"), "json: {json}");

        let cfg2 = AiConfig {
            current_app: Some("app-abc".into()),
            ..AiConfig::default()
        };
        assert!(serde_json::to_string(&cfg2).unwrap().contains("currentApp"));
    }

    #[test]
    fn settings_roundtrip_with_defaults() {
        // AppSettings の欠落フィールドはデフォルト関数で補完される
        let json = r#"{"theme":"dark","language":"en"}"#;
        let s: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(s.theme, "dark");
        assert_eq!(s.language, "en");
        assert_eq!(s.ui_font_size, 14); // default_ui_font_size
        assert_eq!(s.code_font_size, 13); // default_code_font_size
        assert!(s.simple_mode); // default_simple_mode
    }
}


