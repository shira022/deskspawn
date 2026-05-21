use crate::models::config::EnvCheckItem;
use std::process::Command;

/// Check if Node.js >= 20 is installed, and if Rust (cargo) is available.
#[tauri::command]
pub fn check_environment() -> Result<Vec<EnvCheckItem>, String> {
    let mut results: Vec<EnvCheckItem> = Vec::new();
    let is_macos = cfg!(target_os = "macos");

    // ── Node.js ────────────────────────────────────────────────────────────────
    let node_check = check_tool("Node.js", "Node.js >= 20 runtime", "node --version", |output| {
        let version_str = output.trim();
        if let Some(ver) = version_str.strip_prefix('v') {
            let major: u32 = ver.split('.').next().and_then(|s| s.parse().ok()).unwrap_or(0);
            if major >= 20 {
                Ok(())
            } else {
                Err(format!("Node.js version {} is too old. Need >= 20", version_str))
            }
        } else {
            Err(format!("Unexpected node version output: {}", version_str))
        }
    });
    results.push(node_check);

    // ── Rust ───────────────────────────────────────────────────────────────────
    let rust_check = check_tool("Rust", "Rust compiler (rustc + cargo)", "rustc --version", |output| {
        let version_str = output.trim();
        if version_str.contains("rustc") {
            Ok(())
        } else {
            Err(format!("Rust not detected: {}", version_str))
        }
    });
    results.push(rust_check);

    let cargo_check = check_tool("Cargo", "Cargo package manager", "cargo --version", |output| {
        let version_str = output.trim();
        if version_str.contains("cargo") {
            Ok(())
        } else {
            Err(format!("Cargo not detected: {}", version_str))
        }
    });
    results.push(cargo_check);

    // ── VS Build Tools (Windows only) ──────────────────────────────────────────
    if is_macos {
        results.push(EnvCheckItem {
            name: "VS Build Tools".to_string(),
            description: "Visual Studio Build Tools (required for native compilation on Windows)".to_string(),
            check_command: "N/A (macOS)".to_string(),
            status: "ok".to_string(),
            download_url: Some("https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022".to_string()),
        });
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
        results.push(vs_check);
    }

    // ── WebView2 (Windows only) ────────────────────────────────────────────────
    if is_macos {
        results.push(EnvCheckItem {
            name: "WebView2".to_string(),
            description: "WebView2 runtime (required for Tauri on Windows)".to_string(),
            check_command: "N/A (macOS)".to_string(),
            status: "ok".to_string(),
            download_url: Some("https://developer.microsoft.com/en-us/microsoft-edge/webview2/".to_string()),
        });
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
        results.push(wv2_check);
    }

    Ok(results)
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
    }
}

/// Get the download URL for a tool if it's not found.
fn get_download_url(name: &str) -> Option<String> {
    match name {
        "Node.js" => Some("https://nodejs.org/en/download/".to_string()),
        "Rust" | "Cargo" => Some("https://rustup.rs/".to_string()),
        "VS Build Tools" => Some("https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022".to_string()),
        "WebView2" => Some("https://developer.microsoft.com/en-us/microsoft-edge/webview2/".to_string()),
        _ => None,
    }
}
