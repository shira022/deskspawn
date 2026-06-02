use std::io::BufRead;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::State;

/// Timeout (seconds) to wait for the sidecar HTTP server to be ready.
const READY_TIMEOUT_SECS: u64 = 20;

/// Timeout (seconds) to wait for graceful shutdown after SIGTERM.
const GRACEFUL_STOP_TIMEOUT_SECS: u64 = 5;

/// Default sidecar port.
const DEFAULT_SIDECAR_PORT: u16 = 3001;

/// Manages the sidecar Node.js process lifecycle.
///
/// The sidecar is spawned as a child process managed by the Tauri backend.
/// This allows:
/// - Auto-start on Tauri launch
/// - Graceful restart via Tauri command
/// - Auto-cleanup on Tauri exit
pub struct SidecarManager {
    process: Mutex<Option<Child>>,
    project_root: PathBuf,
    sidecar_script: PathBuf,
    security_port: u16,
    /// Actual port the sidecar is listening on (may differ from 3001 if fallback)
    actual_port: Arc<Mutex<u16>>,
    /// Whether the sidecar has been verified as ready (HTTP server is listening)
    ready: Arc<AtomicBool>,
}

impl SidecarManager {
    pub fn new(workspace_path: PathBuf, security_port: u16) -> Self {
        // Determine the sidecar script path using the compile-time CARGO_MANIFEST_DIR.
        // In development (cargo build / cargo run), CARGO_MANIFEST_DIR = src-tauri/
        // The sidecar lives at the project root: <project>/sidecar/src/server.ts
        // In release builds, we fall back to a relative path (assumes CWD is project root).
        let sidecar_script = if cfg!(debug_assertions) {
            // CARGO_MANIFEST_DIR is the directory containing this package's Cargo.toml
            let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            // Go up one level: src-tauri/../ = project root
            let project_root = crate_dir.parent()
                .unwrap_or(&crate_dir);
            project_root.join("sidecar").join("src").join("server.ts")
        } else {
            // Release build: assume the bundler places sidecar/ relative to the binary
            PathBuf::from("sidecar/src/server.ts")
        };

        log::info!("Sidecar script path: {:?}", sidecar_script);

        Self {
            process: Mutex::new(None),
            project_root: workspace_path,
            sidecar_script,
            security_port,
            actual_port: Arc::new(Mutex::new(DEFAULT_SIDECAR_PORT)),
            ready: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start (or restart) the sidecar HTTP server.
    /// After spawning, waits for the sidecar to be ready (HTTP /health responding).
    pub fn start(&self) -> Result<(), String> {
        let mut guard = self.process.lock().map_err(|e| format!("Lock error: {}", e))?;

        // Kill existing process if running
        self.ready.store(false, Ordering::SeqCst);
        if let Some(ref mut child) = *guard {
            Self::graceful_kill(child);
        }

        // Verify the sidecar script exists
        if !self.sidecar_script.exists() {
            return Err(format!(
                "Sidecar script not found at: {:?}. Make sure the sidecar/ directory exists at the project root.",
                self.sidecar_script
            ));
        }

        let script_str = self.sidecar_script.to_string_lossy().to_string();
        log::info!("Starting sidecar script: {:?} (workspace: {:?}, security port: {})", script_str, self.project_root, self.security_port);

        let mut child = Command::new("npx")
            .args(["tsx", &script_str])
            .env("DESKSPAWN_SECURITY_PORT", self.security_port.to_string())
            .current_dir(&self.project_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start sidecar: {}", e))?;

        let child_pid = child.id();
        log::info!("Sidecar process spawned (PID: {})", child_pid);

        // Shared state for stdout parsing
        let actual_port = self.actual_port.clone();
        let ready = self.ready.clone();

        // Drain stdout — parse "sidecar-ready:PORT" signal, log everything else
        if let Some(stdout) = child.stdout.take() {
            thread::spawn(move || {
                let mut buf = String::new();
                let mut reader = std::io::BufReader::new(stdout);
                loop {
                    buf.clear();
                    match reader.read_line(&mut buf) {
                        Ok(0) => break,
                        Err(_) => break,
                        Ok(_) => {
                            let line = buf.trim();
                            // Check for ready signal: "sidecar-ready:3001"
                            if let Some(port_str) = line.strip_prefix("sidecar-ready:") {
                                if let Ok(port) = port_str.parse::<u16>() {
                                    if let Ok(mut p) = actual_port.lock() {
                                        *p = port;
                                    }
                                    ready.store(true, Ordering::SeqCst);
                                    log::info!("Sidecar ready signal received (port {})", port);
                                }
                            } else if !line.is_empty() && !line.starts_with("sidecar-") {
                                // Log sidecar stdout for debugging
                                log::info!("[sidecar] {}", line);
                            }
                        }
                    }
                }
            });
        }

        // Drain stderr — log warnings to Rust log
        if let Some(stderr) = child.stderr.take() {
            thread::spawn(|| {
                let mut buf = String::new();
                let mut reader = std::io::BufReader::new(stderr);
                loop {
                    buf.clear();
                    match reader.read_line(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let line = buf.trim();
                            if !line.is_empty() {
                                log::warn!("[sidecar:err] {}", line);
                            }
                        }
                    }
                }
            });
        }

        *guard = Some(child);

        // Wait for the sidecar to be ready
        self.wait_for_ready()
    }

    /// Poll the sidecar health endpoint until it responds or timeout.
    fn wait_for_ready(&self) -> Result<(), String> {
        let start = std::time::Instant::now();
        let port = *self.actual_port.lock().map_err(|e| format!("Lock error: {}", e))?;
        let health_url = format!("http://127.0.0.1:{}/health", port);

        log::info!("Waiting for sidecar to be ready at {}...", health_url);

        loop {
            // Check if process is still alive
            if !self.is_running() {
                return Err("Sidecar process exited before becoming ready".to_string());
            }

            // Try health endpoint
            match ureq::get(&health_url)
                .config()
                .timeout_connect(Some(Duration::from_secs(2)))
                .timeout_recv_response(Some(Duration::from_secs(2)))
                .build()
                .call()
            {
                Ok(resp) if resp.status() == 200 => {
                    log::info!("Sidecar is ready (health check OK at {})", health_url);
                    self.ready.store(true, Ordering::SeqCst);
                    return Ok(());
                }
                _ => {
                    // Not ready yet — wait and retry
                    if start.elapsed().as_secs() >= READY_TIMEOUT_SECS {
                        return Err(format!(
                            "Sidecar did not become ready within {} seconds (last check: {})",
                            READY_TIMEOUT_SECS, health_url
                        ));
                    }
                    thread::sleep(Duration::from_millis(300));
                }
            }
        }
    }

    /// Gracefully stop the sidecar process.
    /// Sends SIGTERM first, waits, then SIGKILL if still running.
    fn graceful_kill(child: &mut Child) {
        let pid = child.id();
        log::info!("Stopping sidecar (PID: {})...", pid);

        // Send SIGTERM for graceful shutdown
        #[cfg(unix)]
        {
            let status = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .status();
            match status {
                Ok(_) => log::info!("Sent SIGTERM to sidecar (PID: {})", pid),
                Err(e) => log::warn!("Failed to send SIGTERM to sidecar: {}", e),
            }

            // Wait for graceful shutdown
            let deadline = std::time::Instant::now() + Duration::from_secs(GRACEFUL_STOP_TIMEOUT_SECS);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        log::info!("Sidecar (PID: {}) exited gracefully", pid);
                        return;
                    }
                    Ok(None) => {
                        if std::time::Instant::now() >= deadline {
                            log::warn!("Sidecar (PID: {}) did not stop gracefully after {}s, sending SIGKILL", pid, GRACEFUL_STOP_TIMEOUT_SECS);
                            break;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => {
                        log::warn!("Error waiting for sidecar: {}", e);
                        break;
                    }
                }
            }
        }

        // Force kill (SIGKILL) as fallback
        let _ = child.kill();
        let _ = child.wait();
        log::info!("Sidecar (PID: {}) forcefully killed", pid);
    }

    /// Check if the sidecar process is still running.
    pub fn is_running(&self) -> bool {
        if let Ok(mut guard) = self.process.lock() {
            if let Some(ref mut child) = *guard {
                if let Ok(None) = child.try_wait() {
                    return true; // still alive
                }
            }
        }
        false
    }

    /// Check if the sidecar has been verified as ready (HTTP server is listening).
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    /// Get the actual port the sidecar is listening on.
    pub fn actual_port(&self) -> u16 {
        self.actual_port.lock().map(|p| *p).unwrap_or(DEFAULT_SIDECAR_PORT)
    }

    /// Get the PID if the sidecar is running.
    pub fn pid(&self) -> Option<u32> {
        if let Ok(guard) = self.process.lock() {
            guard.as_ref().map(|c| c.id())
        } else {
            None
        }
    }

    /// Stop the sidecar (public wrapper around graceful_kill).
    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.process.lock().map_err(|e| format!("Lock error: {}", e))?;
        self.ready.store(false, Ordering::SeqCst);
        if let Some(ref mut child) = *guard {
            Self::graceful_kill(child);
        }
        *guard = None;
        Ok(())
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Restart the entire Tauri application.
#[tauri::command]
pub fn restart_tauri(app: tauri::AppHandle) {
    log::info!("Restarting Tauri application...");
    app.restart();
}

/// Restart the sidecar (stop + start + wait for ready).
#[tauri::command]
pub fn restart_sidecar(
    sidecar: State<'_, SidecarManager>,
) -> Result<String, String> {
    sidecar.stop()?;
    // Brief pause to ensure port is released after graceful shutdown
    std::thread::sleep(std::time::Duration::from_millis(500));
    sidecar.start()?;
    Ok(format!("Sidecar restarted (port {})", sidecar.actual_port()))
}

/// Stop the sidecar process.
#[tauri::command]
pub fn kill_sidecar(
    sidecar: State<'_, SidecarManager>,
) -> Result<String, String> {
    sidecar.stop()?;
    Ok("Sidecar stopped".to_string())
}

/// Get sidecar status information.
#[tauri::command]
pub fn sidecar_status(
    sidecar: State<'_, SidecarManager>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "running": sidecar.is_running(),
        "ready": sidecar.is_ready(),
        "pid": sidecar.pid(),
        "port": sidecar.actual_port(),
    }))
}

/// Get the actual sidecar port (useful if port fallback changed it).
#[tauri::command]
pub fn sidecar_port(
    sidecar: State<'_, SidecarManager>,
) -> Result<u16, String> {
    Ok(sidecar.actual_port())
}
