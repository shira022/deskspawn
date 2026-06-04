#![allow(dead_code)]

mod commands;
mod engine;
mod models;

use commands::harness::AppState;
use commands::sidecar::SidecarManager;
use std::path::PathBuf;
use tauri::Manager;

/// Run the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            log::info!("DeskSpawn backend initializing...");

            // Determine workspace path
            let workspace_path = determine_workspace_path(app)
                .map_err(|e| Box::new(std::io::Error::other(e)) as Box<dyn std::error::Error>)?;
            log::info!("Workspace path: {:?}", workspace_path);

            // Store in managed state
            app.manage(AppState {
                workspace_path: workspace_path.clone(),
            });

            // Start the security HTTP server (Rust-backed file ops for sidecar)
            let security_port = engine::security_server::start(workspace_path.clone());
            log::info!("Security server started on port {}", security_port);

            // Initialize and start the sidecar manager (pass security port)
            let sidecar_manager = SidecarManager::new(workspace_path.clone(), security_port);
            let mut sidecar_started = false;
            for attempt in 1..=3 {
                match sidecar_manager.start() {
                    Ok(()) => {
                        log::info!("Sidecar started successfully (port {}).", sidecar_manager.actual_port());
                        sidecar_started = true;
                        break;
                    }
                    Err(e) => {
                        log::warn!("Failed to start sidecar (attempt {}/3): {}", attempt, e);
                        if attempt < 3 {
                            std::thread::sleep(std::time::Duration::from_millis(1000 * attempt));
                        }
                    }
                }
            }
            if sidecar_started {
                let sidecar_port = sidecar_manager.actual_port();

                // Push stored API key to sidecar in a background thread so it
                // cannot block setup() (macOS Keychain access may prompt the
                // user or hang, and the Tauri window won't appear until setup
                // returns).
                let key_port = sidecar_port;
                std::thread::spawn(move || {
                    if let Some(api_key) = commands::ai_config::load_full_config_for_sidecar() {
                        commands::ai_config::push_api_key_to_sidecar_on_port(&api_key, key_port);
                        // Clear the key from Rust's stack after pushing
                        drop(api_key);
                    }
                });
            } else {
                log::error!(
                    "Sidecar failed to start after 3 attempts. The frontend will show 'Sidecar Offline'. \
                     Use the restart button or run 'npm run sidecar' manually."
                );
            }
            app.manage(sidecar_manager);

            log::info!("DeskSpawn backend ready.");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // SidecarManager's Drop impl will clean up the child process
                if let Some(sidecar) = window.try_state::<SidecarManager>() {
                    let _ = sidecar.stop();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Harness commands
            commands::harness::read_file,
            commands::harness::list_files,
            commands::harness::apply_artifact,
            commands::harness::run_shell,
            commands::harness::get_errors,
            commands::harness::get_workspace_path,
            commands::harness::initialize_workspace,
            commands::harness::open_in_vscode,
            // Environment check commands
            commands::env_check::check_environment,
            commands::env_check::check_winget,
            commands::env_check::install_with_winget,
            commands::env_check::open_url,
            // Spawn commands
            commands::spawn::spawn_build,
            // AI config commands
            commands::ai_config::save_ai_config,
            commands::ai_config::load_ai_config,
            // Sidecar management commands
            commands::sidecar::restart_tauri,
            commands::sidecar::restart_sidecar,
            commands::sidecar::kill_sidecar,
            commands::sidecar::sidecar_status,
            commands::sidecar::sidecar_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Determine the workspace path.
///
/// Priority:
/// 1. Environment variable `DESKSPAWN_WORKSPACE`
/// 2. Current working directory
/// 3. Fallback to the app's resource directory
fn determine_workspace_path(app: &tauri::App) -> Result<PathBuf, String> {
    // Check environment variable first
    if let Ok(path) = std::env::var("DESKSPAWN_WORKSPACE") {
        let p = PathBuf::from(path);
        if p.is_absolute() {
            log::info!("Using workspace from DESKSPAWN_WORKSPACE: {:?}", p);
            return Ok(p);
        }
    }

    // Try current working directory
    if let Ok(cwd) = std::env::current_dir() {
        log::info!("Using workspace from current directory: {:?}", cwd);
        return Ok(cwd);
    }

    // Fallback: app resource directory
    let resource_dir = app.path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    log::info!("Using workspace from resource directory: {:?}", resource_dir);
    Ok(resource_dir)
}
