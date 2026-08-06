use crate::engine::workspace;
use crate::models::config::AiConfig;
use std::fs;
use std::path::PathBuf;

/// Keyring identifiers for OS keychain storage.
const KEYRING_SERVICE: &str = "com.deskspawn";

/// keychain エントリ名をプロバイダー別に分ける（openai/anthropic/google…）。
fn keyring_user(provider: &str) -> String {
    if provider.is_empty() {
        "api_key".to_string()
    } else {
        format!("api_key_{}", provider)
    }
}

/// File-based credentials file name (stored alongside config.json).
const CREDENTIALS_FILE: &str = "credentials.json";

/// Default sidecar port (used unless fallback is needed).
/// The actual port is provided at runtime by SidecarManager.
pub const DEFAULT_SIDECAR_PORT: u16 = 3009;

// ── Path helpers ──────────────────────────────────────────────────────────────

/// Config directory — unified under `~/deskspawn/config` (see ADR-007).
fn config_dir() -> Result<PathBuf, String> {
    let base = workspace::config_dir()?;
    fs::create_dir_all(&base)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    Ok(base)
}

fn config_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

fn credentials_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join(CREDENTIALS_FILE))
}

// ── OS Keychain helpers ───────────────────────────────────────────────────────

fn save_api_key_to_keychain(api_key: &str, provider: &str) -> Result<bool, String> {
    match keyring::Entry::new(KEYRING_SERVICE, &keyring_user(provider)) {
        Ok(entry) => {
            entry
                .set_password(api_key)
                .map_err(|e| format!("Failed to save API key to keychain: {}", e))?;
            log::info!("API key stored in OS keychain");
            Ok(true)
        }
        Err(e) => {
            log::warn!(
                "OS keychain not available, falling back to config file: {}",
                e
            );
            Ok(false)
        }
    }
}

/// Load the API key from the OS keychain for internal Rust use
/// (e.g., pushing to sidecar). Returns None if unavailable.
fn load_api_key_from_keychain(provider: &str) -> Option<String> {
    match keyring::Entry::new(KEYRING_SERVICE, &keyring_user(provider)) {
        Ok(entry) => match entry.get_password() {
            Ok(password) => {
                log::info!("API key loaded from OS keychain");
                Some(password)
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("No such") || msg.contains("not found") || msg.contains("NoEntry") {
                    log::info!("No API key found in OS keychain (first use)");
                } else {
                    log::warn!("Failed to read API key from keychain: {}", e);
                }
                None
            }
        },
        Err(e) => {
            log::warn!("OS keychain not available: {}", e);
            None
        }
    }
}

/// Delete the API key from the OS keychain.
fn delete_api_key_from_keychain(provider: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &keyring_user(provider)) {
        if entry.delete_credential().is_ok() {
            log::info!("API key removed from OS keychain");
        }
    }
}

// ── Credentials file helpers ──────────────────────────────────────────────────

fn save_api_key_to_file(api_key: &str) -> Result<bool, String> {
    let path = credentials_file_path()?;
    let json = serde_json::json!({ "api_key": api_key });
    let content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;

    // Restrictive permissions on config directory (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(parent) = path.parent() {
            let _ = fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write credentials file: {}", e))?;

    // Restrictive permissions on credentials file (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!("API key saved to credentials file ({})", path.display());
    Ok(true)
}

fn load_api_key_from_file() -> Option<String> {
    let path = credentials_file_path().ok()?;
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    parsed
        .get("api_key")
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn delete_credentials_file() {
    if let Ok(path) = credentials_file_path() {
        if path.exists() && fs::remove_file(&path).is_ok() {
            log::info!("Credentials file deleted");
        }
    }
}

// ── Unified storage helpers ───────────────────────────────────────────────────

/// Save the API key to the given storage method.
///
/// Returns the method actually used: `"keychain"` or `"file"`.
/// When `keychain` is requested but the OS keychain is unavailable, this
/// falls back to the credentials file (M2: UI must reflect the real storage).
fn save_key_to_storage(api_key: &str, provider: &str, method: &str) -> Result<String, String> {
    match method {
        "keychain" => {
            if save_api_key_to_keychain(api_key, provider)? {
                Ok("keychain".to_string())
            } else {
                log::warn!(
                    "OS keychain unavailable — falling back to credentials file ({})",
                    credentials_file_path()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|_| "?".to_string())
                );
                save_api_key_to_file(api_key)?;
                Ok("file".to_string())
            }
        }
        "file" => {
            save_api_key_to_file(api_key)?;
            Ok("file".to_string())
        }
        other => Err(format!("Invalid storage method: {}", other)),
    }
}

/// Load the API key from the given storage method.
fn load_key_from_storage(provider: &str, method: &str) -> Option<String> {
    match method {
        "keychain" => load_api_key_from_keychain(provider),
        "file" => load_api_key_from_file(),
        _ => None,
    }
}

/// Delete the API key from the given storage method.
fn delete_key_from_storage(provider: &str, method: &str) {
    match method {
        "keychain" => delete_api_key_from_keychain(provider),
        "file" => delete_credentials_file(),
        _ => {}
    }
}

/// Read existing AiConfig from disk (returns None if no config exists).
fn read_existing_config() -> Option<AiConfig> {
    let path = config_file_path().ok()?;
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

// ── Sidecar push ──────────────────────────────────────────────────────────────

/// Push the API key to the sidecar's in-memory store.
///
/// The sidecar holds the key only in process memory (never written to disk).
/// This is called:
/// 1. After every `save_ai_config` (key may have changed)
/// 2. On app startup after the sidecar is ready
///
/// `port` defaults to 3009 if not provided (or 0).
pub fn push_api_key_to_sidecar(api_key: &str) {
    push_api_key_to_sidecar_on_port(api_key, None, DEFAULT_SIDECAR_PORT);
}

/// Same as `push_api_key_to_sidecar` but to a specific sidecar port.
/// `custom_endpoint` が None の場合は config.json から読み取って補完する。
pub fn push_api_key_to_sidecar_on_port(
    api_key: &str,
    custom_endpoint: Option<&str>,
    port: u16,
) {
    use std::time::Duration;

    let port = if port == 0 { DEFAULT_SIDECAR_PORT } else { port };
    let url = format!("http://127.0.0.1:{}/api/config", port);
    // x-upstream 廃止後: /v1 プロキシの上流はここで設定した customEndpoint のみ。
    // 明示指定が無ければ config.json から補完する（起動時・保存時どちらでも同期）。
    let resolved_endpoint = match custom_endpoint {
        Some(e) if !e.is_empty() => Some(e.to_string()),
        _ => read_existing_config().and_then(|c| c.custom_endpoint),
    };
    let mut body = serde_json::json!({});
    // 空キーは送らない（/api/config は apiKey フィールドが無ければ既存値を維持する）
    if !api_key.is_empty() {
        body["apiKey"] = serde_json::Value::String(api_key.to_string());
    }
    if let Some(endpoint) = resolved_endpoint {
        body["customEndpoint"] = serde_json::Value::String(endpoint);
    }

    for attempt in 0..5 {
        let mut req = ureq::post(&url)
            .config()
            .timeout_connect(Some(Duration::from_secs(5)))
            .timeout_recv_response(Some(Duration::from_secs(5)))
            .build();
        // H1: サイドカー認証トークン（外部オリジンからの /api/config 改竄を防ぐ）
        if let Some(token) = crate::engine::security::auth_token() {
            req = req.header("X-DeskSpawn-Token", &token);
        }
        match req
            .header("Content-Type", "application/json")
            .send_json(&body)
        {
            Ok(_) => {
                log::info!("API key pushed to sidecar");
                return;
            }
            Err(e) => {
                log::warn!(
                    "Failed to push API key to sidecar (attempt {}/5): {}",
                    attempt + 1,
                    e
                );
                std::thread::sleep(Duration::from_millis(500 * (attempt + 1)));
            }
        }
    }
    log::warn!("Failed to push API key to sidecar after 5 attempts");
}

/// Load the full AI config including the API key (for internal Rust use).
/// Returns None if no config exists.
///
/// The key is loaded from the storage method configured in config.json
/// (keychain or credentials file). Falls back to keychain for backward
/// compatibility if no storage_method is set.
pub fn load_full_config_for_sidecar() -> Option<String> {
    let config = read_existing_config()?;

    // If api_key is directly in config (legacy fallback for headless Linux/CI),
    // use it directly
    if !config.api_key.is_empty() {
        return Some(config.api_key);
    }

    // Determine storage method, defaulting to "keychain" for backward compat
    let method = if config.storage_method.is_empty() {
        "keychain"
    } else {
        &config.storage_method
    };

    load_key_from_storage(&config.provider, method)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// 保存処理の結果（M2: フロントエンドが実際の保存先を表示するために使う）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct SaveKeyResult {
    /// 実際にキーが保存された場所: "keychain" | "file" | "" (保存なし/削除)
    pub method: String,
}

/// Save AI configuration.
///
/// Security model:
///   - `storage_method = "keychain"`:
///       API key → OS keychain (never in config.json)
///   - `storage_method = "file"`:
///       API key → `credentials.json` (600 perms, same directory as config.json)
///   - API key → Sidecar (in-memory, for AI API calls)
///   - Other settings → `~/.config/deskspawn/config.json`
///   - Frontend sees `apiKey: ""` and `apiKeyConfigured: bool`
///
/// Key lifecycle:
///   - If api_key is non-empty: save to chosen storage + push to sidecar
///   - If api_key is empty + api_key_configured is true:
///     keep existing entry (no-op unless storage method changed → auto-migrate)
///   - If api_key is empty + api_key_configured is false:
///     delete all stored keys — user removed the key
#[tauri::command]
pub fn save_ai_config(config: AiConfig) -> Result<SaveKeyResult, String> {
    let path = config_file_path()?;
    let dest_method = if config.storage_method.is_empty() {
        "keychain"
    } else {
        &config.storage_method
    };

    if dest_method != "keychain" && dest_method != "file" {
        return Err(format!("Invalid storage method: {}", dest_method));
    }

    // Load existing config for migration detection
    let existing = read_existing_config();

    let actual_method: String;

    // 1. Handle API key lifecycle
    if !config.api_key.is_empty() {
        // New/changed key → save to selected storage + push to sidecar
        actual_method = save_key_to_storage(&config.api_key, &config.provider, dest_method)?;

        // Clean up old storage if method changed (e.g., user switched
        // dropdown from keychain to file and entered a new key)
        if let Some(ref ex) = existing {
            if ex.storage_method != dest_method {
                delete_key_from_storage(&config.provider, &ex.storage_method);
            }
        }
    } else if config.api_key_configured {
        // No new key but was previously configured
        if let Some(ref ex) = existing {
            if ex.storage_method != dest_method {
                // Storage method changed → auto-migrate
                let key = load_key_from_storage(&config.provider, &ex.storage_method).ok_or_else(|| {
                    format!(
                        "Failed to read existing key from '{}'. \
                         Please re-enter the API key to switch storage.",
                        ex.storage_method
                    )
                })?;
                actual_method = save_key_to_storage(&key, &config.provider, dest_method)?;
                delete_key_from_storage(&config.provider, &ex.storage_method);
                log::info!(
                    "API key migrated from '{}' to '{}'",
                    ex.storage_method,
                    dest_method
                );
            } else {
                // Same storage method, key already there — keep it
                actual_method = ex.storage_method.clone();
            }
        } else {
            // No existing config (shouldn't happen when configured=true, but be safe)
            actual_method = dest_method.to_string();
        }
    } else {
        // User removed key entirely → clean up both
        delete_key_from_storage(&config.provider, "keychain");
        delete_key_from_storage(&config.provider, "file");
        actual_method = String::new();
    }

    // 2. Save config.json WITHOUT the API key
    let mut json_config = config;
    json_config.api_key = String::new(); // never exposed to frontend
    if !actual_method.is_empty() {
        json_config.api_key_configured = true;
    }

    let json = serde_json::to_string_pretty(&json_config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Restrictive permissions on config directory (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(parent) = path.parent() {
            let _ = fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }

    fs::write(&path, &json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    // Restrictive permissions on config file (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!("AI config saved to {}", path.display());

    // サイドカーへ同期（キー + customEndpoint）。x-upstream 廃止後は
    // ここで設定した storedCustomEndpoint が /v1 プロキシの上流になる。
    // キーが設定されている場合のみ push する（削除時はスキップ）。
    if !actual_method.is_empty() {
        if let Some(key) = load_full_config_for_sidecar() {
            push_api_key_to_sidecar(&key);
        }
    }

    Ok(SaveKeyResult {
        method: actual_method,
    })
}

/// Load AI configuration.
///
/// Returns the config with `apiKey` set to empty string when the key is
/// stored in the OS keychain. The frontend uses `apiKeyConfigured` to
/// know a key exists.
///
/// If no config file exists, returns `None`.
#[tauri::command]
pub fn load_ai_config() -> Result<Option<AiConfig>, String> {
    let path = config_file_path()?;

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let config: AiConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;

    Ok(Some(config))
}

/// フロントエンドから呼ばれる: カスタムエンドポイントをサイドカーへ即時同期する。
///
/// 用途: AI 設定の保存前にモデル一覧を取得する場合（/v1/models）など、
/// 保存済み設定を /v1 プロキシの上流（storedCustomEndpoint）に反映する。
/// x-upstream ヘッダ廃止（H1）後の代替経路。
#[tauri::command]
pub fn sync_sidecar_config(endpoint: Option<String>) -> Result<(), String> {
    let key = load_full_config_for_sidecar().unwrap_or_default();
    let ep = match endpoint {
        Some(e) if !e.is_empty() => Some(e),
        _ => read_existing_config().and_then(|c| c.custom_endpoint),
    };
    push_api_key_to_sidecar_on_port(&key, ep.as_deref(), DEFAULT_SIDECAR_PORT);
    Ok(())
}

/// API キーを保存する（デスクトップ: OS キーチェーン → 失敗時は credentials.json）。
///
/// M2: 実際に保存された場所（"keychain" | "file"）を返し、UI が実態に
/// 合わせた表示（「OSキーチェーンに保存」/「設定ファイルに保存（平文）」）を
/// できるようにする。Web 版はこのコマンドが無いため IndexedDB にフォールバックする。
#[tauri::command]
pub fn save_api_key(provider: String, api_key: String) -> Result<SaveKeyResult, String> {
    if api_key.is_empty() {
        delete_api_key(provider.clone())?;
        return Ok(SaveKeyResult {
            method: String::new(),
        });
    }
    // デスクトップの既定はキーチェーン（利用不可時は自動でファイルへフォールバック）
    let method = save_key_to_storage(&api_key, &provider, "keychain")?;
    // サイドカー（メモリ内キーストア）へ同期
    push_api_key_to_sidecar(&api_key);
    Ok(SaveKeyResult { method })
}

/// API キーを読み込む（デスクトップ: OS キーチェーン → credentials.json）。
#[tauri::command]
pub fn load_api_key(provider: String) -> Result<Option<String>, String> {
    let method = read_existing_config()
        .map(|c| c.storage_method)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| "keychain".to_string());
    Ok(load_key_from_storage(&provider, &method))
}

/// API キーを削除する（keychain と credentials.json の両方）。
#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    delete_key_from_storage(&provider, "keychain");
    delete_key_from_storage(&provider, "file");
    Ok(())
}
