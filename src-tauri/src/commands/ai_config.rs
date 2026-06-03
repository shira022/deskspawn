use crate::models::config::AiConfig;
use std::fs;
use std::path::PathBuf;

/// Keyring identifiers for OS keychain storage.
const KEYRING_SERVICE: &str = "com.deskspawn";
const KEYRING_USER: &str = "api_key";

/// File-based credentials file name (stored alongside config.json).
const CREDENTIALS_FILE: &str = "credentials.json";

/// Default sidecar port (used unless fallback is needed).
/// The actual port is provided at runtime by SidecarManager.
pub const DEFAULT_SIDECAR_PORT: u16 = 3001;

/// ── Path helpers ─────────────────────────────────────────────────────────────

fn config_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let base = {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        PathBuf::from(home).join(".config/deskspawn")
    };
    #[cfg(target_os = "windows")]
    let base = {
        let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
        PathBuf::from(appdata).join("DeskSpawn")
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let base = {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        PathBuf::from(home).join(".config/deskspawn")
    };

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

/// ── OS Keychain helpers ──────────────────────────────────────────────────────

fn save_api_key_to_keychain(api_key: &str) -> Result<bool, String> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
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
fn load_api_key_from_keychain() -> Option<String> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
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
fn delete_api_key_from_keychain() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        if entry.delete_credential().is_ok() {
            log::info!("API key removed from OS keychain");
        }
    }
}

/// ── Credentials file helpers ─────────────────────────────────────────────────

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
        if path.exists() {
            if fs::remove_file(&path).is_ok() {
                log::info!("Credentials file deleted");
            }
        }
    }
}

/// ── Unified storage helpers ──────────────────────────────────────────────────

/// Save the API key to the given storage method.
fn save_key_to_storage(api_key: &str, method: &str) -> Result<bool, String> {
    match method {
        "keychain" => save_api_key_to_keychain(api_key),
        "file" => save_api_key_to_file(api_key),
        other => Err(format!("Invalid storage method: {}", other)),
    }
}

/// Load the API key from the given storage method.
fn load_key_from_storage(method: &str) -> Option<String> {
    match method {
        "keychain" => load_api_key_from_keychain(),
        "file" => load_api_key_from_file(),
        _ => None,
    }
}

/// Delete the API key from the given storage method.
fn delete_key_from_storage(method: &str) {
    match method {
        "keychain" => delete_api_key_from_keychain(),
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

/// ── Sidecar push ─────────────────────────────────────────────────────────────

/// Push the API key to the sidecar's in-memory store.
///
/// The sidecar holds the key only in process memory (never written to disk).
/// This is called:
/// 1. After every `save_ai_config` (key may have changed)
/// 2. On app startup after the sidecar is ready
///
/// `port` defaults to 3001 if not provided (or 0).
pub fn push_api_key_to_sidecar(api_key: &str) {
    push_api_key_to_sidecar_on_port(api_key, DEFAULT_SIDECAR_PORT);
}

/// Same as `push_api_key_to_sidecar` but to a specific sidecar port.
pub fn push_api_key_to_sidecar_on_port(api_key: &str, port: u16) {
    use std::time::Duration;

    let port = if port == 0 { DEFAULT_SIDECAR_PORT } else { port };
    let url = format!("http://127.0.0.1:{}/api/config", port);
    let body = serde_json::json!({ "apiKey": api_key });

    for attempt in 0..5 {
        match ureq::post(&url)
            .config()
            .timeout_connect(Some(Duration::from_secs(5)))
            .timeout_recv_response(Some(Duration::from_secs(5)))
            .build()
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

    load_key_from_storage(method)
}

/// ── Tauri commands ───────────────────────────────────────────────────────────

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
pub fn save_ai_config(config: AiConfig) -> Result<(), String> {
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

    let storage_ok: bool;

    // 1. Handle API key lifecycle
    if !config.api_key.is_empty() {
        // New/changed key → save to selected storage + push to sidecar
        storage_ok = save_key_to_storage(&config.api_key, dest_method)?;
        push_api_key_to_sidecar(&config.api_key);

        // Clean up old storage if method changed (e.g., user switched
        // dropdown from keychain to file and entered a new key)
        if let Some(ref ex) = existing {
            if ex.storage_method != dest_method {
                delete_key_from_storage(&ex.storage_method);
            }
        }
    } else if config.api_key_configured {
        // No new key but was previously configured
        if let Some(ref ex) = existing {
            if ex.storage_method != dest_method {
                // Storage method changed → auto-migrate
                let key = load_key_from_storage(&ex.storage_method).ok_or_else(|| {
                    format!(
                        "Failed to read existing key from '{}'. \
                         Please re-enter the API key to switch storage.",
                        ex.storage_method
                    )
                })?;
                save_key_to_storage(&key, dest_method)?;
                delete_key_from_storage(&ex.storage_method);
                push_api_key_to_sidecar(&key);
                storage_ok = true;
                log::info!(
                    "API key migrated from '{}' to '{}'",
                    ex.storage_method,
                    dest_method
                );
            } else {
                // Same storage method, key already there — keep it
                storage_ok = true;
            }
        } else {
            // No existing config (shouldn't happen when configured=true, but be safe)
            storage_ok = true;
        }
    } else {
        // User removed key entirely → clean up both
        delete_key_from_storage("keychain");
        delete_key_from_storage("file");
        storage_ok = false;
    }

    // 2. Save config.json WITHOUT the API key
    let mut json_config = config;
    json_config.api_key = String::new(); // never exposed to frontend
    if storage_ok {
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
    Ok(())
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
