mod commands;
mod engine;
mod models;

use commands::harness::AppState;
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
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)) as Box<dyn std::error::Error>)?;
            log::info!("Workspace path: {:?}", workspace_path);

            // Initialize the error monitor
            let error_monitor = engine::monitor::ErrorMonitor::new();

            // Store in managed state
            app.manage(AppState {
                workspace_path,
                error_monitor,
            });

            log::info!("DeskSpawn backend ready.");
            Ok(())
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
            // Environment check commands
            commands::env_check::check_environment,
            commands::env_check::open_url,
            // Spawn commands
            commands::spawn::spawn_build,
            // AI config commands
            commands::ai_config::save_ai_config,
            commands::ai_config::load_ai_config,
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
