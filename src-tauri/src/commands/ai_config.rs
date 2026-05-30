use crate::models::config::AiConfig;
use std::fs;
use std::path::PathBuf;

/// Keyring identifiers for OS keychain storage.
const KEYRING_SERVICE: &str = "com.deskspawn";
const KEYRING_USER: &str = "api_key";

/// Sidecar base URL.
const SIDECAR_BASE: &str = "http://localhost:3001";

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

/// ── Sidecar push ─────────────────────────────────────────────────────────────

/// Push the API key to the sidecar's in-memory store.
///
/// The sidecar holds the key only in process memory (never written to disk).
/// This is called:
/// 1. After every `save_ai_config` (key may have changed)
/// 2. On app startup after the sidecar is ready
pub fn push_api_key_to_sidecar(api_key: &str) {
    let url = format!("{}/api/config", SIDECAR_BASE);
    let body = serde_json::json!({ "apiKey": api_key });

    for attempt in 0..5 {
        match ureq::post(&url)
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
                std::thread::sleep(std::time::Duration::from_millis(500 * (attempt + 1)));
            }
        }
    }
    log::warn!("Failed to push API key to sidecar after 5 attempts");
}

/// Load the full AI config including the API key (for internal Rust use).
/// Returns None if no config exists.
pub fn load_full_config_for_sidecar() -> Option<String> {
    let path = config_file_path().ok()?;
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let config: AiConfig = serde_json::from_str(&content).ok()?;

    // If api_key is empty, try keychain
    if config.api_key.is_empty() {
        load_api_key_from_keychain()
    } else {
        Some(config.api_key)
    }
}

/// ── Tauri commands ───────────────────────────────────────────────────────────

/// Save AI configuration.
///
/// Security model (Tauri / keychain available):
///   - API key → OS keychain (never in config.json)
///   - API key → Sidecar (in-memory, for AI API calls)
///   - Other settings → ~/.config/deskspawn/config.json
///   - Frontend sees `apiKey: ""` and `apiKeyConfigured: true`
///
/// Security model (browser / no keychain):
///   - API key stays in localStorage (browser fallback)
///   - apiKeyConfigured stays false
///   - Sidecar receives key from frontend directly
///
/// Key lifecycle:
///   - If api_key is non-empty: save to keychain + push to sidecar
///   - If api_key is empty + api_key_configured is true:
///     keep existing keychain entry (no-op)
///   - If api_key is empty + api_key_configured is false:
///     delete keychain entry (if any) — user removed the key
#[tauri::command]
pub fn save_ai_config(config: AiConfig) -> Result<(), String> {
    let path = config_file_path()?;

    let keychain_ok: bool;

    // 1. Handle API key lifecycle
    if !config.api_key.is_empty() {
        // New/changed key → save to keychain + push to sidecar
        keychain_ok = save_api_key_to_keychain(&config.api_key)?;
        push_api_key_to_sidecar(&config.api_key);
    } else if config.api_key_configured {
        // Empty key but configured flag is true → keep existing keychain entry.
        // This happens when the frontend re-saves config without the key
        // (key is already in the keychain, frontend has no access to it).
        keychain_ok = true;
    } else {
        // Empty key and not configured → remove keychain entry (user removed key)
        keychain_ok = false;
        delete_api_key_from_keychain();
    }

    // 2. Save config.json WITHOUT the API key
    let mut json_config = config;
    json_config.api_key = String::new(); // never exposed to frontend
    if keychain_ok {
        json_config.api_key_configured = true;
    }
    // When keychain is unavailable, api_key stays in JSON (backward compat
    // for headless Linux / CI environments)

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
