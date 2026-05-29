use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::path::PathBuf;
use tauri::State;

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
        }
    }

    /// Start (or restart) the sidecar HTTP server.
    pub fn start(&self) -> Result<(), String> {
        let mut guard = self.process.lock().map_err(|e| format!("Lock error: {}", e))?;

        // Kill existing process if running
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
            let _ = child.wait();
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

        let child = Command::new("npx")
            .args(["tsx", &script_str])
            .env("DESKSPAWN_SECURITY_PORT", self.security_port.to_string())
            .current_dir(&self.project_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start sidecar: {}", e))?;

        log::info!("Sidecar started (PID: {})", child.id());
        *guard = Some(child);
        Ok(())
    }

    /// Gracefully stop the sidecar process.
    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.process.lock().map_err(|e| format!("Lock error: {}", e))?;
        if let Some(ref mut child) = *guard {
            log::info!("Stopping sidecar (PID: {})...", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
        Ok(())
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

    /// Get the PID if the sidecar is running.
    pub fn pid(&self) -> Option<u32> {
        if let Ok(guard) = self.process.lock() {
            guard.as_ref().map(|c| c.id())
        } else {
            None
        }
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

/// Restart the sidecar (stop + start).
#[tauri::command]
pub fn restart_sidecar(
    sidecar: State<'_, SidecarManager>,
) -> Result<String, String> {
    sidecar.stop()?;
    // Brief pause to ensure port is released
    std::thread::sleep(std::time::Duration::from_millis(500));
    sidecar.start()?;
    Ok("Sidecar restarted".to_string())
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
        "pid": sidecar.pid(),
    }))
}
