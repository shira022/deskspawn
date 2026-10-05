#![allow(dead_code)]

mod commands;
mod engine;
mod models;

use commands::harness::AppState;
use commands::sidecar::SidecarManager;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;

/// `APPMODEL_ERROR_NO_PACKAGE`: `GetCurrentPackageFullName` の戻り値で
/// 「パッケージ識別子なし（非パッケージ実行）」を意味する。
#[cfg(windows)]
const APPMODEL_ERROR_NO_PACKAGE: i32 = 15700;

/// `ERROR_INSUFFICIENT_BUFFER`: パッケージ有りで、バッファ長 0 + ヌル
/// バッファに対して呼び出した際に必ず返る戻り値。
#[cfg(windows)]
const ERROR_INSUFFICIENT_BUFFER: i32 = 122;

// Windows のアプリパッケージ有無をプローブする kernel32 API。
//
// 新しいクレート依存を追加しないため direct FFI 宣言で利用する。
// 引数は (書き込みに必要なバッファ長, バッファ)。バッファ長 0 + ヌル
// ポインタでの呼び出しは仕様どおりのプローブとして許可されている。
#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentPackageFullName(
        package_full_name_length: *mut u32,
        package_full_name: *mut u16,
    ) -> i32;
}

/// プロセスが OS アプリパッケージ（Windows では MSIX / Microsoft Store 版）
/// の内側で実行されているかを返す。
///
/// Microsoft Store 版ではストアが更新を握るため Tauri updater を動かしては
/// いけない。判定が true のときは updater の登録と起動時チェックを両方スキップ
/// し、false のときは従来どおり updater を有効に保つ（NSIS 版等）。
///
/// Windows: `kernel32!GetCurrentPackageFullName` を extern "system" で直接
/// FFI 呼び出しする。戻り値 122（ERROR_INSUFFICIENT_BUFFER）ならパッケージ有、
/// 15700（APPMODEL_ERROR_NO_PACKAGE）なら非パッケージと判定する。それ以外の
/// 想定外 rc は警告ログを出して非パッケージ扱い（fail-open: updater は有効のまま）。
///
/// 非 Windows プラットフォームでは常に `false`。
#[cfg(windows)]
fn is_packaged() -> bool {
    // SAFETY: 第一引数は有効な stack 上の u32、第二引数は長さ 0 に対する
    // ヌルバッファ（仕様上許可）。書き込まれるのは length のみ。
    let rc = unsafe {
        let mut length: u32 = 0;
        GetCurrentPackageFullName(&mut length, std::ptr::null_mut())
    };
    match rc {
        ERROR_INSUFFICIENT_BUFFER => {
            log::info!(
                "Packaged (Store/MSIX) build detected: updater disabled \
                 (updates are store-managed)."
            );
            true
        }
        APPMODEL_ERROR_NO_PACKAGE => false,
        _ => {
            log::warn!(
                "Unexpected GetCurrentPackageFullName rc={} (expected {} or {}); \
                 treating as non-packaged, updater stays enabled.",
                rc,
                ERROR_INSUFFICIENT_BUFFER,
                APPMODEL_ERROR_NO_PACKAGE
            );
            false
        }
    }
}

/// 非 Windows では常にパッケージ無し（NSIS 版 / 開発実行と同様に扱う）。
#[cfg(not(windows))]
fn is_packaged() -> bool {
    false
}

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

            // MSIX (Microsoft Store) 版ではストアが更新を握るため updater を
            // 無効化する。非パッケージ版（NSIS / 開発実行）は従来どおり有効。
            // パッケージ検出時の info ログは is_packaged() 内で出力される。
            #[cfg(desktop)]
            let packaged = is_packaged();

            // Register updater plugin (skipped for packaged builds)
            #[cfg(desktop)]
            if !packaged {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            // Determine workspace path (home-based, stable — see engine/workspace)
            let workspace_path = engine::workspace::determine_workspace_path()
                .map_err(|e| Box::new(std::io::Error::other(e)) as Box<dyn std::error::Error>)?;
            log::info!("Workspace path: {:?}", workspace_path);

            // Ensure the full ~/deskspawn tree exists (apps/templates/config/...)
            if let Err(e) = engine::workspace::ensure_deskspawn_tree() {
                log::error!("Failed to ensure deskspawn tree: {}", e);
            }

            // First-run setup (idempotent): seed registry, verify dirs.
            match engine::setup::run_setup() {
                Ok(summary) => log::info!("Setup complete: {}", summary),
                Err(e) => log::error!("Setup failed: {}", e),
            }

            // Store in managed state
            app.manage(AppState {
                workspace_path: workspace_path.clone(),
            });

            // H1: 認証トークンを初期化（サイドカー / security_server / IPC で共有）
            let auth_token = engine::security::init_auth_token();

            // Start the security HTTP server (Rust-backed file ops for sidecar)
            let security_port =
                engine::security_server::start(workspace_path.clone(), auth_token);
            log::info!("Security server started on port {}", security_port);

            // Initialize and start the sidecar manager (pass security port)
            let sidecar_manager = SidecarManager::new(workspace_path.clone(), security_port);
            let app_handle = app.handle().clone();
            let mut sidecar_started = false;
            for attempt in 1..=3 {
                match sidecar_manager.start(&app_handle) {
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
                        // カスタムエンドポイントは push 側で config から読み取るため
                        // ここでは明示指定しない（None）
                        commands::ai_config::push_api_key_to_sidecar_on_port(&api_key, None, key_port);
                        // Clear the key from Rust's stack after pushing
                        drop(api_key);
                    }
                });
            } else {
                log::error!(
                    "Sidecar failed to start after 3 attempts. The frontend will show 'Sidecar Offline'. \
                     Use the restart button to try again."
                );
            }
            app.manage(sidecar_manager);

            // Spawn update check in background (non-blocking, no dialog on startup).
            // Packaged (Store/MSIX) builds skip it entirely so the updater
            // endpoint is never contacted and the store keeps update ownership.
            #[cfg(desktop)]
            if !packaged {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match handle.updater() {
                        Ok(updater) => {
                            match updater.check().await {
                                Ok(Some(update)) => {
                                    log::info!(
                                        "Update available: {} → {}",
                                        update.current_version,
                                        update.version
                                    );
                                }
                                Ok(None) => log::info!("No updates available."),
                                Err(e) => log::warn!("Update check failed: {}", e),
                            }
                        }
                        Err(e) => log::warn!("Failed to initialize updater: {}", e),
                    }
                });
            }

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
            // App management commands (real files under ~/deskspawn/apps)
            commands::apps::list_apps,
            commands::apps::create_app,
            commands::apps::delete_app,
            commands::apps::list_app_files,
            commands::apps::read_app_file,
            commands::apps::write_app_file,
            commands::apps::delete_app_file,
            commands::apps::write_app_files,
            commands::apps::get_chat_history,
            commands::apps::save_chat_messages,
            commands::apps::export_app_zip,
            commands::apps::import_app_zip,
            // Environment check commands
            commands::env_check::check_environment,
            commands::env_check::check_winget,
            commands::env_check::open_url,
            // AI config commands
            commands::ai_config::save_ai_config,
            commands::ai_config::load_ai_config,
            commands::ai_config::sync_sidecar_config,
            commands::ai_config::save_api_key,
            commands::ai_config::load_api_key,
            commands::ai_config::delete_api_key,
            commands::ai_config::save_provider_config,
            commands::ai_config::load_provider_config,
            commands::ai_config::save_last_provider,
            commands::ai_config::load_last_provider,
            commands::ai_config::save_current_app,
            commands::ai_config::load_current_app,
            commands::ai_config::save_settings,
            commands::ai_config::load_settings,
            commands::ai_config::reset_app_data,
            commands::ai_config::get_keyring_service,
            // Sidecar management commands
            commands::sidecar::restart_tauri,
            commands::sidecar::restart_sidecar,
            commands::sidecar::kill_sidecar,
            commands::sidecar::sidecar_status,
            commands::sidecar::sidecar_port,
            commands::sidecar::get_sidecar_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::is_packaged;

    /// CI / 開発実行（NSIS 版・cargo test の通常 exe）で is_packaged() が
    /// false を返すことを検証する。updater 本体の挙動（登録・起動時チェック）は
    /// 実機検証で担保する。
    ///
    /// 前提: パッケージ識別子を継承したシェル（Store 版アプリの子プロセス等）から
    /// 実行していないこと。CI の通常ランナーはこの前提を満たす。
    #[test]
    fn non_packaged_run_reports_not_packaged() {
        assert!(!is_packaged());
    }
}

