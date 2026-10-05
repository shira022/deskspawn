use crate::models::config::{EnvCheckItem, WingetStatus};
use std::process::Command;

const WINGET_NODEJS: &str = "OpenJS.NodeJS.LTS";

/// Check if Node.js >= 20 is installed.
#[tauri::command]
pub fn check_environment() -> Result<Vec<EnvCheckItem>, String> {
    let mut results: Vec<EnvCheckItem> = Vec::new();

    // ── Node.js ────────────────────────────────────────────────────────────
    let node_check = check_tool(
        "Node.js",
        "Node.js >= 20 runtime",
        "node --version",
        |output| {
            let version_str = output.trim();
            if let Some(ver) = version_str.strip_prefix('v') {
                let major: u32 = ver
                    .split('.')
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                if major >= 20 {
                    Ok(())
                } else {
                    Err(format!(
                        "Node.js version {} is too old. Need >= 20",
                        version_str
                    ))
                }
            } else {
                Err(format!("Unexpected node version output: {}", version_str))
            }
        },
    );
    results.push(add_winget_meta(node_check, Some(WINGET_NODEJS), Some(30)));

    Ok(results)
}

/// Check whether winget (Windows Package Manager) is available on this system.
#[tauri::command]
pub fn check_winget() -> Result<WingetStatus, String> {
    if cfg!(target_os = "macos") {
        return Ok(WingetStatus {
            available: false,
            version: None,
            message: "winget is not available on macOS. Please install dependencies manually."
                .to_string(),
        });
    }

    let reg_check = Command::new("reg")
        .args([
            "query",
            "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\winget.exe",
            "/ve",
        ])
        .output();

    if let Ok(out) = &reg_check {
        if out.status.success() {
            let winget_path =
                String::from_utf8_lossy(&out.stdout).trim().to_string();
            if let Ok(ver_out) = Command::new("winget").arg("--version").output() {
                let version = String::from_utf8_lossy(&ver_out.stdout)
                    .trim()
                    .to_string();
                return Ok(WingetStatus {
                    available: true,
                    version: Some(version),
                    message: format!("winget found at: {}", winget_path),
                });
            }
        }
    }

    if let Ok(out) = Command::new("winget").arg("--version").output() {
        if out.status.success() {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            return Ok(WingetStatus {
                available: true,
                version: Some(version),
                message: "winget is available".to_string(),
            });
        }
    }

    Ok(WingetStatus {
        available: false,
        version: None,
        message: "winget is not available. Install 'App Installer' from the Microsoft Store to enable automatic setup.".to_string(),
    })
}

/// 外部ブラウザで開いても安全な URL かどうか（C2: コマンドインジェクション対策）。
///
/// 許可条件:
/// - http/https スキーム
/// - ホストが localhost / 127.0.0.1 / [::1] のみ（プレビュー用途）
/// - ホスト直後は「:ポート」「/」「終端」のみ（localhost.evil.com 等を拒否）
/// - cmd のシェルメタ文字（& | < > ^ ( ) ; % ' " ` $）を含まない
pub fn is_safe_open_url(url: &str) -> bool {
    const META_CHARS: &[char] = &[
        '&', '|', '<', '>', '^', '(', ')', ';', '%', '\'', '"', '`', '$',
    ];
    if url.chars().any(|c| META_CHARS.contains(&c)) {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    const ALLOWED_HOSTS: &[&str] = &[
        "http://localhost",
        "https://localhost",
        "http://127.0.0.1",
        "https://127.0.0.1",
        "http://[::1]",
        "https://[::1]",
    ];
    ALLOWED_HOSTS.iter().any(|prefix| {
        if !lower.starts_with(prefix) {
            return false;
        }
        let rest = &lower[prefix.len()..];
        rest.is_empty() || rest.starts_with(':') || rest.starts_with('/')
    })
}

/// Open a URL in the default system browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    // C2: URL 検証 — localhost プレビュー以外は開かせない + シェルメタ文字を拒否
    if !is_safe_open_url(&url) {
        return Err(format!("URL rejected by safety policy: {}", url));
    }
    let result = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map(|_| ())
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("cmd")
            .args(["/c", "start", &url])
            .spawn()
            .map(|_| ())
    } else {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map(|_| ())
    };
    result.map_err(|e| format!("Failed to open URL: {}", e))
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn check_tool(
    name: &str,
    description: &str,
    check_command: &str,
    validator: fn(&str) -> Result<(), String>,
) -> EnvCheckItem {
    let parts: Vec<&str> = check_command.splitn(2, ' ').collect();
    let program = parts.first().unwrap_or(&"");
    let args = parts.get(1).unwrap_or(&"");

    let output = Command::new(program)
        .args(args.split_whitespace())
        .output();

    let (status, download_url) = match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            match validator(&stdout) {
                Ok(_) => ("ok".to_string(), None),
                Err(msg) => {
                    log::warn!("{} check failed: {}", name, msg);
                    ("fail".to_string(), get_download_url(name))
                }
            }
        }
        Err(e) => {
            log::warn!("{} check error: {}", name, e);
            ("fail".to_string(), get_download_url(name))
        }
    };

    EnvCheckItem {
        name: name.to_string(),
        description: description.to_string(),
        check_command: check_command.to_string(),
        status,
        download_url,
        winget_package: None,
        size_mb: None,
    }
}

fn add_winget_meta(
    mut item: EnvCheckItem,
    winget_package: Option<&str>,
    size_mb: Option<u32>,
) -> EnvCheckItem {
    item.winget_package = winget_package.map(|s| s.to_string());
    item.size_mb = size_mb;
    item
}

fn get_download_url(name: &str) -> Option<String> {
    match name {
        "Node.js" => Some("https://nodejs.org/en/download/".to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_open_url_accepts_localhost_previews() {
        assert!(is_safe_open_url("http://localhost:5173"));
        assert!(is_safe_open_url("http://localhost:5173/"));
        assert!(is_safe_open_url("http://localhost:5173/path/to/page"));
        assert!(is_safe_open_url("http://127.0.0.1:5174"));
        assert!(is_safe_open_url("https://localhost:8443"));
        assert!(is_safe_open_url("http://[::1]:5174"));
        assert!(is_safe_open_url("http://localhost"));
    }

    #[test]
    fn safe_open_url_rejects_injection_and_external_hosts() {
        // C2: cmd インジェクション（& でコマンド連結）
        assert!(!is_safe_open_url("http://localhost:5173 & calc"));
        assert!(!is_safe_open_url("http://x & calc"));
        assert!(!is_safe_open_url("http://localhost & calc"));
        assert!(!is_safe_open_url("http://localhost:5173 | whoami"));
        assert!(!is_safe_open_url("http://localhost:5173; rm -rf ~"));
        assert!(!is_safe_open_url("http://localhost:5173`whoami`"));
        assert!(!is_safe_open_url("http://localhost:5173$(whoami)"));
        assert!(!is_safe_open_url("http://localhost:5173\" & calc"));
        // ホスト偽装
        assert!(!is_safe_open_url("http://localhost.evil.com"));
        assert!(!is_safe_open_url("http://localhost@evil.com"));
        // 外部ホスト / 他スキーム
        assert!(!is_safe_open_url("https://example.com"));
        assert!(!is_safe_open_url("file:///etc/passwd"));
        assert!(!is_safe_open_url("ms-settings:display"));
        assert!(!is_safe_open_url("javascript:alert(1)"));
        assert!(!is_safe_open_url(""));
    }
}
