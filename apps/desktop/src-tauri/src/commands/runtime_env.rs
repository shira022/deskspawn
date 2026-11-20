use serde::{Deserialize, Serialize};
use std::io::{BufRead, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::Emitter;

const BUN_ID: &str = "Oven-sh.Bun";
const WEBVIEW2_ID: &str = "Microsoft.EdgeWebView2Runtime";
const WEBVIEW2_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

const BUN_LABEL: &str = "Bun";
const WEBVIEW2_LABEL: &str = "Microsoft Edge WebView2 Runtime";

const BUN_MANUAL_URL: &str = "https://bun.sh/docs/installation";
const WEBVIEW2_MANUAL_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

const CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(600);
const PROGRESS_LINE_LIMIT: usize = 200;
const STDERR_TAIL_LIMIT: usize = 500;

#[cfg(windows)]
const BUN_EXE: &str = "bun.exe";
#[cfg(not(windows))]
const BUN_EXE: &str = "bun";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimePrerequisite {
    Bun,
    WebView2,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCheckItem {
    pub id: String,
    pub label: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub source: String,
    pub winget_id: String,
    pub size_mb: u32,
    pub manual_url: String,
}

/// Check the two runtime prerequisites the first-run UI cares about.
#[tauri::command(async)]
pub fn check_runtime_env() -> Result<Vec<RuntimeCheckItem>, String> {
    Ok(vec![check_bun(), check_webview2()])
}

/// Install a runtime prerequisite via winget without blocking the UI thread.
#[tauri::command]
pub async fn install_runtime_prerequisite(
    app: tauri::AppHandle,
    kind: RuntimePrerequisite,
) -> Result<Vec<RuntimeCheckItem>, String> {
    tauri::async_runtime::spawn_blocking(move || run_install(&app, &kind))
        .await
        .map_err(|e| format!("winget install task failed: {}", e))?
}

fn run_install(
    app: &tauri::AppHandle,
    kind: &RuntimePrerequisite,
) -> Result<Vec<RuntimeCheckItem>, String> {
    run_winget_install(app, kind)?;

    if matches!(kind, RuntimePrerequisite::Bun) {
        restart_sidecar_after_install(app);
    }

    check_runtime_env()
}

fn restart_sidecar_after_install(app: &tauri::AppHandle) {
    use tauri::Manager;

    let result = (|| -> Result<(), String> {
        let sidecar = app
            .try_state::<crate::commands::sidecar::SidecarManager>()
            .ok_or_else(|| "Sidecar manager is not available".to_string())?;
        sidecar.stop()?;
        std::thread::sleep(Duration::from_millis(500));
        sidecar.start(app)
    })();

    if let Err(e) = result {
        log::warn!("Failed to restart sidecar after Bun install: {}", e);
    }
}

fn run_winget_install(app: &tauri::AppHandle, kind: &RuntimePrerequisite) -> Result<(), String> {
    let kind_label = match kind {
        RuntimePrerequisite::Bun => "bun",
        RuntimePrerequisite::WebView2 => "webview2",
    };

    let mut child = Command::new("winget")
        .args(winget_install_args(kind))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start winget: {}", e))?;

    let (tx, rx) = std::sync::mpsc::channel::<(bool, String)>();
    if let Some(stdout) = child.stdout.take() {
        stream_lines(stdout, false, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        stream_lines(stderr, true, tx.clone());
    }
    drop(tx);

    let deadline = Instant::now() + INSTALL_TIMEOUT;
    let mut stderr_tail = String::new();

    let status = loop {
        while let Ok((is_stderr, line)) = rx.try_recv() {
            record_line(app, kind_label, is_stderr, &line, &mut stderr_tail);
        }

        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Failed to wait for winget: {}", e));
            }
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("winget install timed out".to_string());
        }

        std::thread::sleep(Duration::from_millis(100));
    };

    // Drain lines that were produced just before the process exited.
    let drain_deadline = Instant::now() + Duration::from_millis(500);
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok((is_stderr, line)) => {
                record_line(app, kind_label, is_stderr, &line, &mut stderr_tail);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if Instant::now() >= drain_deadline {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    if !status.success() {
        let tail = tail_chars(&stderr_tail, STDERR_TAIL_LIMIT);
        return Err(format!(
            "winget install failed (exit {:?}): {}",
            status.code(),
            tail
        ));
    }

    Ok(())
}

fn stream_lines<R: Read + Send + 'static>(
    reader: R,
    is_stderr: bool,
    tx: std::sync::mpsc::Sender<(bool, String)>,
) {
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(reader).lines() {
            let Ok(line) = line else { break };
            if tx.send((is_stderr, line)).is_err() {
                break;
            }
        }
    });
}

fn record_line(
    app: &tauri::AppHandle,
    kind_label: &str,
    is_stderr: bool,
    line: &str,
    stderr_tail: &mut String,
) {
    if is_stderr {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            stderr_tail.push_str(trimmed);
            stderr_tail.push('\n');
            if stderr_tail.chars().count() > 4000 {
                *stderr_tail = tail_chars(stderr_tail, 4000);
            }
        }
    }

    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let truncated: String = trimmed.chars().take(PROGRESS_LINE_LIMIT).collect();
    let _ = app.emit(
        "runtime-install-progress",
        serde_json::json!({ "kind": kind_label, "line": truncated }),
    );
}

fn tail_chars(value: &str, limit: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= limit {
        value.to_string()
    } else {
        chars[chars.len() - limit..].iter().collect()
    }
}

fn check_bun() -> RuntimeCheckItem {
    let resolved = crate::engine::bun::resolve_bun_path();
    let env_path = std::env::var_os("BUN_PATH")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty());
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    let home_bun = home_dir().map(|home| home.join(".bun").join("bin").join(BUN_EXE));
    let winget_link = winget_link_candidate();

    let source = bun_source_label(
        resolved.as_deref(),
        env_path.as_deref(),
        exe_dir.as_deref(),
        home_bun.as_deref(),
        winget_link.as_deref(),
    );
    let version = resolved.as_deref().and_then(bun_version);
    let status = if resolved.is_some() { "ok" } else { "missing" };

    RuntimeCheckItem {
        id: "bun".to_string(),
        label: BUN_LABEL.to_string(),
        status: status.to_string(),
        version,
        source: source.to_string(),
        winget_id: BUN_ID.to_string(),
        size_mb: 100,
        manual_url: BUN_MANUAL_URL.to_string(),
    }
}

fn check_webview2() -> RuntimeCheckItem {
    let version = read_webview2_version();
    let status = if version.is_some() { "ok" } else { "missing" };
    let source = if version.is_some() {
        "registry"
    } else {
        "none"
    };

    RuntimeCheckItem {
        id: "webview2".to_string(),
        label: WEBVIEW2_LABEL.to_string(),
        status: status.to_string(),
        version,
        source: source.to_string(),
        winget_id: WEBVIEW2_ID.to_string(),
        size_mb: 2,
        manual_url: WEBVIEW2_MANUAL_URL.to_string(),
    }
}

fn read_webview2_version() -> Option<String> {
    let hklm = format!(
        "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{}",
        WEBVIEW2_GUID
    );
    let hkcu = format!(
        "HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{}",
        WEBVIEW2_GUID
    );

    for key in [hklm, hkcu] {
        let Ok(output) = Command::new("reg")
            .args(["query", &key, "/v", "pv"])
            .output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(version) = parse_reg_pv(&stdout) {
            return Some(version);
        }
    }

    None
}

fn bun_version(path: &Path) -> Option<String> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        let mut reader = std::io::BufReader::new(stdout);
        let _ = reader.read_to_string(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + CHECK_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return None;
            }
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return None;
        }

        std::thread::sleep(Duration::from_millis(50));
    };

    let output = reader.join().ok()?;
    if !status.success() {
        return None;
    }
    let version = output.trim();
    if version.is_empty() {
        None
    } else {
        Some(version.to_string())
    }
}

fn parse_reg_pv(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let mut parts = line.split_whitespace();
        if parts.next() != Some("pv") {
            continue;
        }
        let _kind = parts.next()?;
        let value = parts.next()?.trim();
        if value.is_empty() || value == "0.0.0.0" {
            return None;
        }
        return Some(value.to_string());
    }
    None
}

fn winget_install_args(kind: &RuntimePrerequisite) -> Vec<String> {
    let id = match kind {
        RuntimePrerequisite::Bun => BUN_ID,
        RuntimePrerequisite::WebView2 => WEBVIEW2_ID,
    };

    vec![
        "install".to_string(),
        "--id".to_string(),
        id.to_string(),
        "--exact".to_string(),
        "--silent".to_string(),
        "--accept-package-agreements".to_string(),
        "--accept-source-agreements".to_string(),
        "--disable-interactivity".to_string(),
    ]
}

fn bun_source_label(
    resolved: Option<&Path>,
    env_path: Option<&Path>,
    exe_dir: Option<&Path>,
    home_bun: Option<&Path>,
    winget_link: Option<&Path>,
) -> &'static str {
    let Some(resolved) = resolved else {
        return "none";
    };

    if env_path == Some(resolved) {
        return "env";
    }
    if exe_dir.map(|dir| dir.join(BUN_EXE)).as_deref() == Some(resolved) {
        return "bundled";
    }
    if home_bun == Some(resolved) {
        return "home";
    }
    if winget_link == Some(resolved) {
        return "winget";
    }
    "path"
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
    }
}

fn winget_link_candidate() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA").map(|base| {
            PathBuf::from(base)
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join(BUN_EXE)
        })
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_reg_pv_returns_the_registry_value() {
        let stdout = "\r\nHKEY_LOCAL_MACHINE\\...\r\n    pv    REG_SZ    156.0.4314.58\r\n\r\n";
        assert_eq!(parse_reg_pv(stdout).as_deref(), Some("156.0.4314.58"));
    }

    #[test]
    fn parse_reg_pv_rejects_empty_zero_and_missing() {
        assert_eq!(parse_reg_pv(""), None);
        assert_eq!(parse_reg_pv("    pv    REG_SZ    \r\n"), None);
        assert_eq!(parse_reg_pv("    pv    REG_SZ    0.0.0.0\r\n"), None);
        assert_eq!(parse_reg_pv("    name    REG_SZ    value\r\n"), None);
    }

    #[test]
    fn winget_install_args_are_fixed_and_use_exact_id() {
        let bun = winget_install_args(&RuntimePrerequisite::Bun);
        assert_eq!(bun.first().map(String::as_str), Some("install"));
        assert!(bun.iter().any(|arg| arg == "--exact"));
        assert!(bun.iter().any(|arg| arg == "Oven-sh.Bun"));
        assert!(bun.iter().any(|arg| arg == "--silent"));
        assert!(bun.iter().any(|arg| arg == "--disable-interactivity"));

        let webview = winget_install_args(&RuntimePrerequisite::WebView2);
        assert_eq!(webview.first().map(String::as_str), Some("install"));
        assert!(webview
            .iter()
            .any(|arg| arg == "Microsoft.EdgeWebView2Runtime"));
        assert!(webview.iter().any(|arg| arg == "--exact"));
    }

    #[test]
    fn bun_source_label_classifies_each_origin() {
        let resolved = Path::new("/opt/bun");
        let env_path = Path::new("/env/bun");
        let exe_dir = Path::new("/app");
        let home_bun = Path::new("/opt/bun-home/bin/bun");
        let winget = Path::new("/winget/bun.exe");

        assert_eq!(bun_source_label(None, None, None, None, None), "none");
        assert_eq!(
            bun_source_label(
                Some(env_path),
                Some(env_path),
                Some(exe_dir),
                Some(home_bun),
                Some(winget)
            ),
            "env"
        );
        assert_eq!(
            bun_source_label(
                Some(&exe_dir.join(BUN_EXE)),
                Some(env_path),
                Some(exe_dir),
                Some(home_bun),
                Some(winget)
            ),
            "bundled"
        );
        assert_eq!(
            bun_source_label(
                Some(home_bun),
                Some(env_path),
                Some(exe_dir),
                Some(home_bun),
                Some(winget)
            ),
            "home"
        );
        assert_eq!(
            bun_source_label(
                Some(winget),
                Some(env_path),
                Some(exe_dir),
                Some(home_bun),
                Some(winget)
            ),
            "winget"
        );
        assert_eq!(
            bun_source_label(
                Some(resolved),
                Some(env_path),
                Some(exe_dir),
                Some(home_bun),
                Some(winget)
            ),
            "path"
        );
    }

    #[test]
    fn runtime_prerequisite_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&RuntimePrerequisite::WebView2).unwrap(),
            "\"webview2\""
        );
        assert_eq!(
            serde_json::to_string(&RuntimePrerequisite::Bun).unwrap(),
            "\"bun\""
        );
    }
}
