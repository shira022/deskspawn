use crate::models::config::AiConfig;
use std::fs;
use std::path::PathBuf;

/// Get the config directory path for DeskSpawn.
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

/// Config file path.
fn config_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

/// Save AI configuration to a local JSON file.
///
/// The API key is stored in the config file alongside other settings.
/// Future iterations should use OS keychain services for the API key.
#[tauri::command]
pub fn save_ai_config(config: AiConfig) -> Result<(), String> {
    let path = config_file_path()?;

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Set restrictive permissions on the config file (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(parent) = path.parent() {
            let _ = fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }

    fs::write(&path, &json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    // Set file permissions to owner-only (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!("AI config saved to {}", path.display());
    Ok(())
}

/// Load AI configuration from the local JSON file.
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
