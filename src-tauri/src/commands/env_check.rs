use crate::models::config::{EnvCheckItem, SetupProgress, WingetStatus};
use std::process::Command;
use tauri::Emitter;

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

/// Install a package using winget. Emits progress events during installation.
#[tauri::command]
pub async fn install_with_winget(
    app: tauri::AppHandle,
    package: String,
) -> Result<String, String> {
    let package_name = get_package_display_name(&package);
    log::info!(
        "Starting winget install for: {} ({})",
        package,
        package_name
    );

    let _ = app.emit(
        "env-setup-progress",
        SetupProgress {
            package: package.clone(),
            stage: "starting".to_string(),
            progress_percent: 0,
            message: format!("{} のインストールを準備中...", package_name),
        },
    );

    let mut cmd = Command::new("winget");
    cmd.arg("install")
        .arg("--id")
        .arg(&package)
        .arg("--silent")
        .arg("--accept-source-agreements")
        .arg("--accept-package-agreements");

    let _ = app.emit(
        "env-setup-progress",
        SetupProgress {
            package: package.clone(),
            stage: "downloading".to_string(),
            progress_percent: 10,
            message: format!("{} をダウンロード中...", package_name),
        },
    );

    let output = cmd.output().map_err(|e| format!("Failed to run winget: {}", e))?;

    let _ = app.emit(
        "env-setup-progress",
        SetupProgress {
            package: package.clone(),
            stage: "installing".to_string(),
            progress_percent: 50,
            message: format!("{} をインストール中...", package_name),
        },
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() || stdout.contains("No applicable update found") || stdout.contains("already installed") {
        let _ = app.emit(
            "env-setup-progress",
            SetupProgress {
                package: package.clone(),
                stage: "complete".to_string(),
                progress_percent: 100,
                message: format!("{} のインストールが完了しました", package_name),
            },
        );
        log::info!("winget install success for: {}", package);
        Ok(format!("Successfully installed {}", package_name))
    } else {
        let err_msg = if !stderr.is_empty() {
            stderr.to_string()
        } else {
            format!("winget exited with status: {}", output.status)
        };
        let _ = app.emit(
            "env-setup-progress",
            SetupProgress {
                package: package.clone(),
                stage: "error".to_string(),
                progress_percent: 0,
                message: format!("{} のインストールに失敗しました: {}", package_name, err_msg),
            },
        );
        log::error!("winget install failed for {}: {}", package, err_msg);
        Err(format!(
            "Failed to install {}: {}",
            package_name, err_msg
        ))
    }
}

/// Open a URL in the default system browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
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

fn get_package_display_name(package: &str) -> &str {
    match package {
        WINGET_NODEJS => "Node.js",
        _ => package,
    }
}
