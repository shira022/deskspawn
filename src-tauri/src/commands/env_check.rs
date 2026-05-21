use crate::models::config::{EnvCheckItem, SetupProgress, WingetStatus};
use std::process::Command;
use tauri::Emitter;

/// Winget package IDs for each tool.
const WINGET_NODEJS: &str = "OpenJS.NodeJS.LTS";
const WINGET_RUSTUP: &str = "Rustlang.Rustup";
const WINGET_VS_BUILD_TOOLS: &str = "Microsoft.VisualStudio.2022.BuildTools";
const WINGET_WEBVIEW2: &str = "Microsoft.EdgeWebView2Runtime";

/// Check if Node.js >= 20 is installed, and if Rust (cargo) is available.
/// Also includes winget package IDs for auto-install where applicable.
#[tauri::command]
pub fn check_environment() -> Result<Vec<EnvCheckItem>, String> {
    let mut results: Vec<EnvCheckItem> = Vec::new();
    let is_macos = cfg!(target_os = "macos");

    // ── Node.js ────────────────────────────────────────────────────────────────
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

    // ── Rust ───────────────────────────────────────────────────────────────────
    let rust_check = check_tool(
        "Rust",
        "Rust compiler (rustc + cargo)",
        "rustc --version",
        |output| {
            let version_str = output.trim();
            if version_str.contains("rustc") {
                Ok(())
            } else {
                Err(format!("Rust not detected: {}", version_str))
            }
        },
    );
    results.push(add_winget_meta(rust_check, Some(WINGET_RUSTUP), Some(400)));

    // Cargo is checked alongside Rust — skip separate winget entry
    let cargo_check = check_tool(
        "Cargo",
        "Cargo package manager",
        "cargo --version",
        |output| {
            let version_str = output.trim();
            if version_str.contains("cargo") {
                Ok(())
            } else {
                Err(format!("Cargo not detected: {}", version_str))
            }
        },
    );
    results.push(add_winget_meta(cargo_check, None, None));

    // ── VS Build Tools (Windows only) ──────────────────────────────────────────
    if is_macos {
        results.push(add_winget_meta(
            EnvCheckItem {
                name: "VS Build Tools".to_string(),
                description:
                    "Visual Studio Build Tools (required for native compilation on Windows)"
                        .to_string(),
                check_command: "N/A (macOS)".to_string(),
                status: "ok".to_string(),
                download_url: Some(
                    "https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022"
                        .to_string(),
                ),
                winget_package: None,
                size_mb: None,
            },
            None,
            None,
        ));
    } else {
        let vs_check = check_tool(
            "VS Build Tools",
            "Visual Studio Build Tools (required for native compilation)",
            "vswhere -latest -property installationPath",
            |output| {
                if output.trim().is_empty() {
                    Err("Visual Studio Build Tools not found".to_string())
                } else {
                    Ok(())
                }
            },
        );
        results.push(add_winget_meta(vs_check, Some(WINGET_VS_BUILD_TOOLS), Some(4500)));
    }

    // ── WebView2 (Windows only) ────────────────────────────────────────────────
    if is_macos {
        results.push(add_winget_meta(
            EnvCheckItem {
                name: "WebView2".to_string(),
                description: "WebView2 runtime (required for Tauri on Windows)".to_string(),
                check_command: "N/A (macOS)".to_string(),
                status: "ok".to_string(),
                download_url: Some(
                    "https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
                        .to_string(),
                ),
                winget_package: None,
                size_mb: None,
            },
            None,
            None,
        ));
    } else {
        let wv2_check = check_tool(
            "WebView2",
            "WebView2 runtime (required for Tauri)",
            "reg query \"HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}\" /v pv",
            |output| {
                if output.contains("pv") {
                    Ok(())
                } else {
                    Err("WebView2 not detected".to_string())
                }
            },
        );
        results.push(add_winget_meta(wv2_check, Some(WINGET_WEBVIEW2), Some(120)));
    }

    Ok(results)
}

/// Check whether winget (Windows Package Manager) is available on this system.
#[tauri::command]
pub fn check_winget() -> Result<WingetStatus, String> {
    // On macOS, winget is not available
    if cfg!(target_os = "macos") {
        return Ok(WingetStatus {
            available: false,
            version: None,
            message: "winget is not available on macOS. Please install dependencies manually."
                .to_string(),
        });
    }

    // Check via registry first (more reliable on Windows)
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
            // Get version
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

    // Fallback: try running winget directly
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
///
/// For VS Build Tools, special `--override` flags are applied to include the
/// C++ desktop development workload automatically.
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

    // Emit starting event
    let _ = app.emit(
        "env-setup-progress",
        SetupProgress {
            package: package.clone(),
            stage: "starting".to_string(),
            progress_percent: 0,
            message: format!("{} のインストールを準備中...", package_name),
        },
    );

    // Build winget command
    let mut cmd = Command::new("winget");
    cmd.arg("install")
        .arg("--id")
        .arg(&package)
        .arg("--silent")
        .arg("--accept-source-agreements")
        .arg("--accept-package-agreements");

    // Special handling for VS Build Tools: include C++ workload
    if package == WINGET_VS_BUILD_TOOLS {
        cmd.arg("--override");
        cmd.arg("--wait --quiet --add Microsoft.VisualStudio.Workload.NativeDesktop --includeRecommended");
    }

    // Emit downloading event
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

    // Emit installing event
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
        // Emit complete event
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
        // Emit error event
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Run a check command and return an EnvCheckItem with the result.
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

/// Attach winget metadata to an EnvCheckItem.
fn add_winget_meta(
    mut item: EnvCheckItem,
    winget_package: Option<&str>,
    size_mb: Option<u32>,
) -> EnvCheckItem {
    item.winget_package = winget_package.map(|s| s.to_string());
    item.size_mb = size_mb;
    item
}

/// Get the download URL for a tool if it's not found.
fn get_download_url(name: &str) -> Option<String> {
    match name {
        "Node.js" => Some("https://nodejs.org/en/download/".to_string()),
        "Rust" | "Cargo" => Some("https://rustup.rs/".to_string()),
        "VS Build Tools" => Some(
            "https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022"
                .to_string(),
        ),
        "WebView2" => Some(
            "https://developer.microsoft.com/en-us/microsoft-edge/webview2/".to_string(),
        ),
        _ => None,
    }
}

/// Get a human-readable display name for a winget package ID.
fn get_package_display_name(package: &str) -> &str {
    match package {
        WINGET_NODEJS => "Node.js",
        WINGET_RUSTUP => "Rust",
        WINGET_VS_BUILD_TOOLS => "VS Build Tools",
        WINGET_WEBVIEW2 => "WebView2",
        _ => package,
    }
}
