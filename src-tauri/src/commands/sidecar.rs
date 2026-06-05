use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::State;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

/// Timeout (seconds) to wait for the sidecar HTTP server to be ready.
const READY_TIMEOUT_SECS: u64 = 20;

/// Default sidecar port.
const DEFAULT_SIDECAR_PORT: u16 = 3001;

/// Manages the sidecar process lifecycle via Tauri's shell plugin.
///
/// The sidecar is compiled via `bun build --compile` into a standalone
/// binary and bundled into the .app via `bundle.externalBin`. Tauri's
/// shell plugin handles path resolution in both dev and production.
pub struct SidecarManager {
    process: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    project_root: PathBuf,
    security_port: u16,
    /// Actual port the sidecar is listening on (may differ from 3001 if fallback)
    actual_port: Arc<Mutex<u16>>,
    /// Whether the sidecar has been verified as ready (HTTP server is listening)
    ready: Arc<AtomicBool>,
    /// Tracks if the sidecar process has terminated (via CommandEvent::Terminated)
    terminated: Arc<AtomicBool>,
    /// Cached PID for status reporting
    pid: Arc<Mutex<Option<u32>>>,
}

impl SidecarManager {
    pub fn new(workspace_path: PathBuf, security_port: u16) -> Self {
        log::info!("SidecarManager created (workspace: {:?})", workspace_path);

        Self {
            process: Mutex::new(None),
            project_root: workspace_path,
            security_port,
            actual_port: Arc::new(Mutex::new(DEFAULT_SIDECAR_PORT)),
            ready: Arc::new(AtomicBool::new(false)),
            terminated: Arc::new(AtomicBool::new(true)), // start as terminated
            pid: Arc::new(Mutex::new(None)),
        }
    }

    /// Start (or restart) the sidecar binary.
    /// Uses the Tauri shell plugin's sidecar API to resolve the binary
    /// path in both dev (src-tauri/binaries/) and production (.app bundle).
    pub fn start(&self, app_handle: &tauri::AppHandle) -> Result<(), String> {
        let mut guard = self.process.lock().map_err(|e| format!("Lock error: {}", e))?;

        // Mark not-ready, kill existing process if running
        self.ready.store(false, Ordering::SeqCst);
        self.terminated.store(false, Ordering::SeqCst);
        Self::kill_child(&mut *guard);

        log::info!(
            "Starting sidecar binary (security port: {})...",
            self.security_port
        );

        // Build the sidecar command via Tauri shell plugin.
        // Binary location: src-tauri/binaries/deskspawn-sidecar-<target-triple>
        // Dev mode  → found at project root
        // Build mode → bundled inside .app bundle
        let sidecar = app_handle
            .shell()
            .sidecar("deskspawn-sidecar")
            .map_err(|e| format!("Failed to create sidecar command: {}", e))?
            .env("DESKSPAWN_SECURITY_PORT", self.security_port.to_string());

        let (mut rx, child) = sidecar
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        log::info!("Sidecar process spawned");

        // Store PID
        if let Ok(mut p) = self.pid.lock() {
            *p = Some(child.pid());
        }

        // Shared state for event handler
        let actual_port = self.actual_port.clone();
        let ready = self.ready.clone();
        let terminated = self.terminated.clone();

        // Spawn an async task to read stdout/stderr events
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let text = String::from_utf8_lossy(&bytes);
                        for line in text.lines() {
                            let trimmed = line.trim();
                            // Check for ready signal: "sidecar-ready:3001"
                            if let Some(port_str) =
                                trimmed.strip_prefix("sidecar-ready:")
                            {
                                if let Ok(port) = port_str.parse::<u16>() {
                                    if let Ok(mut p) = actual_port.lock() {
                                        *p = port;
                                    }
                                    ready.store(true, Ordering::SeqCst);
                                    log::info!(
                                        "Sidecar ready signal received (port {})",
                                        port
                                    );
                                }
                            } else if !trimmed.is_empty()
                                && !trimmed.starts_with("sidecar-")
                            {
                                log::info!("[sidecar] {}", trimmed);
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        let text = String::from_utf8_lossy(&bytes);
                        for line in text.lines() {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                log::warn!("[sidecar:err] {}", trimmed);
                            }
                        }
                    }
                    CommandEvent::Terminated(_) => {
                        terminated.store(true, Ordering::SeqCst);
                        log::info!("Sidecar process terminated");
                    }
                    _ => {}
                }
            }
            log::info!("Sidecar event stream ended");
        });

        *guard = Some(child);
        // Drop guard before wait_for_ready to avoid deadlock on
        // process lock inside is_running().
        drop(guard);

        self.wait_for_ready()
    }

    /// Poll the sidecar health endpoint until it responds or timeout.
    fn wait_for_ready(&self) -> Result<(), String> {
        let start = std::time::Instant::now();
        let port = *self
            .actual_port
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
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

    /// Kill a child process, taking ownership of it.
    /// CommandChild::kill() takes self by value (no &mut self variant).
    fn kill_child(child: &mut Option<tauri_plugin_shell::process::CommandChild>) {
        if let Some(c) = child.take() {
            let pid = c.pid();
            if let Err(e) = c.kill() {
                log::warn!("Failed to kill sidecar (PID {}): {}", pid, e);
            } else {
                log::info!("Sidecar (PID {}) killed", pid);
            }
        }
    }

    /// Check if the sidecar process is still running.
    /// Uses the Terminated event flag rather than try_wait(), which
    /// is not available on tauri_plugin_shell::process::CommandChild.
    pub fn is_running(&self) -> bool {
        // If process was removed from the mutex (e.g. after kill), not running.
        if let Ok(guard) = self.process.lock() {
            if guard.is_none() {
                return false;
            }
        } else {
            return false;
        }
        // Check termination flag set by event handler
        !self.terminated.load(Ordering::SeqCst)
    }

    /// Check if the sidecar has been verified as ready (HTTP server is listening).
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    /// Get the actual port the sidecar is listening on.
    pub fn actual_port(&self) -> u16 {
        self.actual_port
            .lock()
            .map(|p| *p)
            .unwrap_or(DEFAULT_SIDECAR_PORT)
    }

    /// Get the PID if the sidecar is running.
    pub fn pid(&self) -> Option<u32> {
        self.pid.lock().ok().and_then(|p| *p)
    }

    /// Stop the sidecar process.
    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self
            .process
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        self.ready.store(false, Ordering::SeqCst);
        self.terminated.store(true, Ordering::SeqCst);
        Self::kill_child(&mut *guard);
        if let Ok(mut p) = self.pid.lock() {
            *p = None;
        }
        log::info!("Sidecar stopped");
        Ok(())
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.process.lock() {
            Self::kill_child(&mut *guard);
        }
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
    app: tauri::AppHandle,
) -> Result<String, String> {
    sidecar.stop()?;
    // Brief pause to ensure port is released
    std::thread::sleep(std::time::Duration::from_millis(500));
    sidecar.start(&app)?;
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

/// Get the actual sidecar port.
#[tauri::command]
pub fn sidecar_port(
    sidecar: State<'_, SidecarManager>,
) -> Result<u16, String> {
    Ok(sidecar.actual_port())
}
