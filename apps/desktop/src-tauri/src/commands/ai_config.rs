use crate::engine::workspace;
use crate::models::config::{AiConfig, AppSettings, ProviderConfig};
use std::fs;
use std::path::PathBuf;

/// Keyring identifiers for OS keychain storage.
///
/// Default service: `com.deskspawn`（本番の API キー）。
/// テスト/E2E では環境変数 `DESKSPAWN_KEYCHAIN_SERVICE` で service 名を
/// 差し替え、本番キーチェーン ent を分離する（実績 2026-08-15・レビュー指摘対応:
/// E2E テスト02 がダミーキーを保存すると本番 service に上書きされてしまう。
/// E2E 実行時はこの env を `com.deskspawn.e2e` 等に設定すること）。
fn keyring_service() -> String {
    std::env::var("DESKSPAWN_KEYCHAIN_SERVICE").unwrap_or_else(|_| "com.deskspawn".to_string())
}

/// keychain エントリ名をプロバイダー別に分ける（openai/anthropic/google…）。
fn keyring_user(provider: &str) -> String {
    if provider.is_empty() {
        "api_key".to_string()
    } else {
        format!("api_key_{}", provider)
    }
}

/// File-based credentials file name (stored alongside config.json).
const CREDENTIALS_FILE: &str = "credentials.json";

/// Default sidecar port (used unless fallback is needed).
/// The actual port is provided at runtime by SidecarManager.
pub const DEFAULT_SIDECAR_PORT: u16 = 3009;

// ── Path helpers ──────────────────────────────────────────────────────────────

/// Config directory — unified under `~/deskspawn/config` (see ADR-007).
fn config_dir() -> Result<PathBuf, String> {
    let base = workspace::config_dir()?;
    fs::create_dir_all(&base)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    Ok(base)
}

fn config_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

fn credentials_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join(CREDENTIALS_FILE))
}

// ── OS Keychain helpers ───────────────────────────────────────────────────────

fn save_api_key_to_keychain(api_key: &str, provider: &str) -> Result<bool, String> {
    match keyring::Entry::new(&keyring_service(), &keyring_user(provider)) {
        Ok(entry) => {
            entry
                .set_password(api_key)
                .map_err(|e| format!("Failed to save API key to keychain: {}", e))?;
            log::info!("API key stored in OS keychain");
            Ok(true)
        }
        Err(e) => {
            log::warn!(
                "OS keychain not available, falling back to config file: {}",
                e
            );
            Ok(false)
        }
    }
}

/// Load the API key from the OS keychain for internal Rust use
/// (e.g., pushing to sidecar). Returns None if unavailable.
fn load_api_key_from_keychain(provider: &str) -> Option<String> {
    match keyring::Entry::new(&keyring_service(), &keyring_user(provider)) {
        Ok(entry) => match entry.get_password() {
            Ok(password) => {
                log::info!("API key loaded from OS keychain");
                Some(password)
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("No such") || msg.contains("not found") || msg.contains("NoEntry") {
                    log::info!("No API key found in OS keychain (first use)");
                } else {
                    log::warn!("Failed to read API key from keychain: {}", e);
                }
                None
            }
        },
        Err(e) => {
            log::warn!("OS keychain not available: {}", e);
            None
        }
    }
}

/// Delete the API key from the OS keychain.
fn delete_api_key_from_keychain(provider: &str) {
    if let Ok(entry) = keyring::Entry::new(&keyring_service(), &keyring_user(provider)) {
        if entry.delete_credential().is_ok() {
            log::info!("API key removed from OS keychain");
        }
    }
}

// ── Credentials file helpers ──────────────────────────────────────────────────

/// credentials.json パスがユーザープロファイル（HOME / USERPROFILE）内かを判定する。
///
/// アンカーは `engine::workspace::root_dir()` と同じ `HOME`/`USERPROFILE` を使う
/// （APPDATA ではない — 実パスは `~/deskspawn/config/credentials.json` で APPDATA 配下に
/// 解決されないため、APPDATA 基準の旧実装では正当なパスまで拒否されていた・実績 2026-08-22）。
/// ディレクトリ境界（`alice` vs `alice2`）と大文字小文字・区切り文字差を吸収して比較する。
fn is_within_profile(profile: &str, path: &str) -> bool {
    let root = profile.replace('\\', "/").trim_end_matches('/').to_lowercase();
    if root.is_empty() {
        // プロファイル変数が空でも DESKSPAWN_ROOT 経由でパス解決だけは成功し得るが、
        // 平文キーのため「プロファイル内のみ」ポリシーで拒否する（安全側）。
        return false;
    }
    let p = path.replace('\\', "/").to_lowercase();
    p == root || p.starts_with(&format!("{root}/"))
}

/// 現在のユーザープロファイル（HOME/USERPROFILE）基準で `path` を検証する薄いラッパー。
fn is_within_user_profile(path: &std::path::Path) -> bool {
    let profile = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    is_within_profile(&profile, &path.to_string_lossy())
}

fn save_api_key_to_file(api_key: &str) -> Result<bool, String> {
    let path = credentials_file_path()?;
    // セキュリティ: credentials.json がユーザープロファイルの外に解決されたら
    // 拒否する (平文キーが共有ディレクトリに書かれる事故の防止)。
    // Windows / Unix 両方で有効（Unix は HOME 基準・実パスは常に HOME 配下なので通常通過）。
    if !is_within_user_profile(&path) {
        return Err(format!(
            "Refusing to write credentials file outside user profile: {}",
            path.display()
        ));
    }
    let json = serde_json::json!({ "api_key": api_key });
    let content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;

    // Restrictive permissions on config directory (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(parent) = path.parent() {
            let _ = fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }

    // Windows: ファイルを「隠し属性」で作成する (ユーザープロファイル内・親DACL継承で
    // ユーザーのみアクセス可とする防御の補助)。完全なACL制限は OS キーチェーン
    // 利用が本筋 (file フォールバックは keychain 利用不可時の保険)。
    #[cfg(windows)]
    {
        use std::io::Write;
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .attributes(FILE_ATTRIBUTE_HIDDEN)
            .open(&path)
        {
            let _ = f.write_all(content.as_bytes());
        } else {
            // OpenOptions 失敗時は通常書き込みにフォールバック (ユーザープロファイル内は保護済み)
            fs::write(&path, &content)
                .map_err(|e| format!("Failed to write credentials file: {}", e))?;
        }
    }
    #[cfg(not(windows))]
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write credentials file: {}", e))?;

    // Restrictive permissions on credentials file (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!("API key saved to credentials file ({})", path.display());
    Ok(true)
}

fn load_api_key_from_file() -> Option<String> {
    let path = credentials_file_path().ok()?;
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    parsed
        .get("api_key")
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn delete_credentials_file() {
    if let Ok(path) = credentials_file_path() {
        if path.exists() && fs::remove_file(&path).is_ok() {
            log::info!("Credentials file deleted");
        }
    }
}

// ── Unified storage helpers ───────────────────────────────────────────────────

/// Save the API key to the given storage method.
///
/// Returns the method actually used: `"keychain"` or `"file"`.
/// When `keychain` is requested but the OS keychain is unavailable, this
/// falls back to the credentials file (M2: UI must reflect the real storage).
fn save_key_to_storage(api_key: &str, provider: &str, method: &str) -> Result<String, String> {
    match method {
        "keychain" => {
            if save_api_key_to_keychain(api_key, provider)? {
                Ok("keychain".to_string())
            } else {
                log::warn!(
                    "OS keychain unavailable — falling back to credentials file ({})",
                    credentials_file_path()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|_| "?".to_string())
                );
                save_api_key_to_file(api_key)?;
                Ok("file".to_string())
            }
        }
        "file" => {
            save_api_key_to_file(api_key)?;
            Ok("file".to_string())
        }
        other => Err(format!("Invalid storage method: {}", other)),
    }
}

/// Load the API key from the given storage method.
fn load_key_from_storage(provider: &str, method: &str) -> Option<String> {
    match method {
        "keychain" => load_api_key_from_keychain(provider),
        "file" => load_api_key_from_file(),
        _ => None,
    }
}

/// Delete the API key from the given storage method.
fn delete_key_from_storage(provider: &str, method: &str) {
    match method {
        "keychain" => delete_api_key_from_keychain(provider),
        "file" => delete_credentials_file(),
        _ => {}
    }
}

/// Read existing AiConfig from disk (returns None if no config exists).
pub fn read_existing_config() -> Option<AiConfig> {
    let path = config_file_path().ok()?;
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Write the AI config to disk with restrictive permissions (Unix only).
pub fn write_config(config: &AiConfig) -> Result<(), String> {
    let path = config_file_path()?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    // Restrictive permissions on config directory (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(parent) = path.parent() {
            let _ = fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }

    fs::write(&path, &json).map_err(|e| format!("Failed to write config file: {e}"))?;

    // Restrictive permissions on config file (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!("AI config saved to {}", path.display());
    Ok(())
}

// ── Sidecar push ──────────────────────────────────────────────────────────────

/// Push the API key to the sidecar's in-memory store.
///
/// The sidecar holds the key only in process memory (never written to disk).
/// This is called:
/// 1. After every `save_ai_config` (key may have changed)
/// 2. On app startup after the sidecar is ready
///
/// `port` defaults to 3009 if not provided (or 0).
pub fn push_api_key_to_sidecar(api_key: &str) {
    push_api_key_to_sidecar_on_port(api_key, None, DEFAULT_SIDECAR_PORT);
}

/// Same as `push_api_key_to_sidecar` but to a specific sidecar port.
/// `custom_endpoint` が None の場合は config.json から読み取って補完する。
pub fn push_api_key_to_sidecar_on_port(
    api_key: &str,
    custom_endpoint: Option<&str>,
    port: u16,
) {
    use std::time::Duration;

    let port = if port == 0 { DEFAULT_SIDECAR_PORT } else { port };
    let url = format!("http://127.0.0.1:{}/api/config", port);
    // x-upstream 廃止後: /v1 プロキシの上流はここで設定した customEndpoint のみ。
    // 明示指定が無ければ config.json から補完する（起動時・保存時どちらでも同期）。
    let resolved_endpoint = match custom_endpoint {
        Some(e) if !e.is_empty() => Some(e.to_string()),
        _ => read_existing_config().and_then(|c| c.custom_endpoint),
    };
    let mut body = serde_json::json!({});
    // 空キーは送らない（/api/config は apiKey フィールドが無ければ既存値を維持する）
    if !api_key.is_empty() {
        body["apiKey"] = serde_json::Value::String(api_key.to_string());
    }
    if let Some(endpoint) = resolved_endpoint {
        body["customEndpoint"] = serde_json::Value::String(endpoint);
    }

    // サイドカーへの同期は「ベストエフォート」。タイムアウトは短く（2秒×2回）:
    // サイドカーが応答しない環境では /v1/models の取得が 30 秒以上ブロックされ、
    // モデル欄が「読み込み中...」のままになる（実績 2026-08-15）。同期に失敗しても
    // 後続の /v1/models が 400/502 を返し、UI は手動入力モードへフォールバックする。
    for attempt in 0..2 {
        let mut req = ureq::post(&url)
            .config()
            .timeout_connect(Some(Duration::from_secs(2)))
            .timeout_recv_response(Some(Duration::from_secs(2)))
            .build();
        // H1: サイドカー認証トークン（外部オリジンからの /api/config 改竄を防ぐ）
        if let Some(token) = crate::engine::security::auth_token() {
            req = req.header("X-DeskSpawn-Token", &token);
        }
        match req
            .header("Content-Type", "application/json")
            .send_json(&body)
        {
            Ok(_) => {
                log::info!("API key pushed to sidecar");
                return;
            }
            Err(e) => {
                log::warn!(
                    "Failed to push API key to sidecar (attempt {}/5): {}",
                    attempt + 1,
                    e
                );
                std::thread::sleep(Duration::from_millis(500 * (attempt + 1)));
            }
        }
    }
    log::warn!("Failed to push API key to sidecar after 5 attempts");
}

/// Load the full AI config including the API key (for internal Rust use).
/// Returns None if no config exists.
///
/// The key is loaded from the storage method configured in config.json
/// (keychain or credentials file). Falls back to keychain for backward
/// compatibility if no storage_method is set.
pub fn load_full_config_for_sidecar() -> Option<String> {
    let config = read_existing_config()?;

    // If api_key is directly in config (legacy fallback for headless Linux/CI),
    // use it directly
    if !config.api_key.is_empty() {
        return Some(config.api_key);
    }

    // Determine storage method, defaulting to "keychain" for backward compat
    let method = if config.storage_method.is_empty() {
        "keychain"
    } else {
        &config.storage_method
    };

    let key = load_key_from_storage(&config.provider, method);
    if key.is_some() {
        return key;
    }
    // 監査指摘対応 (2026-08-27): save_api_key は keychain 利用不可時に credentials.json へ
    // フォールバックするが storage_method を更新しないため、method=keychain のまま
    // keychain が使えない環境では file 保存されたキーが読み戻せず、サイドカーへ
    // 同期されない（load_api_key と同じ alternate-method フォールバック）。
    let alt = if method == "keychain" {
        "file"
    } else {
        "keychain"
    };
    load_key_from_storage(&config.provider, alt)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// 保存処理の結果（M2: フロントエンドが実際の保存先を表示するために使う）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct SaveKeyResult {
    /// 実際にキーが保存された場所: "keychain" | "file" | "" (保存なし/削除)
    pub method: String,
}

/// Save AI configuration.
///
/// Security model:
///   - `storage_method = "keychain"`:
///       API key → OS keychain (never in config.json)
///   - `storage_method = "file"`:
///       API key → `credentials.json` (600 perms, same directory as config.json)
///   - API key → Sidecar (in-memory, for AI API calls)
///   - Other settings → `~/.config/deskspawn/config.json`
///   - Frontend sees `apiKey: ""` and `apiKeyConfigured: bool`
///
/// Key lifecycle:
///   - If api_key is non-empty: save to chosen storage + push to sidecar
///   - If api_key is empty + api_key_configured is true:
///     keep existing entry (no-op unless storage method changed → auto-migrate)
///   - If api_key is empty + api_key_configured is false:
///     delete all stored keys — user removed the key
#[tauri::command]
pub fn save_ai_config(config: AiConfig) -> Result<SaveKeyResult, String> {
    let dest_method = if config.storage_method.is_empty() {
        "keychain"
    } else {
        &config.storage_method
    };

    if dest_method != "keychain" && dest_method != "file" {
        return Err(format!("Invalid storage method: {}", dest_method));
    }

    // Load existing config for migration detection
    let existing = read_existing_config();

    let actual_method: String;

    // 1. Handle API key lifecycle
    if !config.api_key.is_empty() {
        // New/changed key → save to selected storage + push to sidecar
        actual_method = save_key_to_storage(&config.api_key, &config.provider, dest_method)?;

        // Clean up old storage if method changed (e.g., user switched
        // dropdown from keychain to file and entered a new key)
        if let Some(ref ex) = existing {
            if ex.storage_method != dest_method {
                delete_key_from_storage(&config.provider, &ex.storage_method);
            }
        }
    } else if config.api_key_configured {
        // No new key but was previously configured
        if let Some(ref ex) = existing {
            if ex.storage_method != dest_method {
                // Storage method changed → auto-migrate
                let key = load_key_from_storage(&config.provider, &ex.storage_method).ok_or_else(|| {
                    format!(
                        "Failed to read existing key from '{}'. \
                         Please re-enter the API key to switch storage.",
                        ex.storage_method
                    )
                })?;
                actual_method = save_key_to_storage(&key, &config.provider, dest_method)?;
                delete_key_from_storage(&config.provider, &ex.storage_method);
                log::info!(
                    "API key migrated from '{}' to '{}'",
                    ex.storage_method,
                    dest_method
                );
            } else {
                // Same storage method, key already there — keep it
                actual_method = ex.storage_method.clone();
            }
        } else {
            // No existing config (shouldn't happen when configured=true, but be safe)
            actual_method = dest_method.to_string();
        }
    } else {
        // User removed key entirely → clean up both
        delete_key_from_storage(&config.provider, "keychain");
        delete_key_from_storage(&config.provider, "file");
        actual_method = String::new();
    }

    // 2. Save config.json WITHOUT the API key
    let mut json_config = config;
    json_config.api_key = String::new(); // never exposed to frontend
    if !actual_method.is_empty() {
        json_config.api_key_configured = true;
    }
    // Multi-provider: keep the existing map and upsert the current provider so
    // per-provider settings survive provider switching.
    if let Some(existing_cfg) = existing.as_ref() {
        json_config.providers = existing_cfg.providers.clone();
    }
    json_config.providers.insert(
        json_config.provider.clone(),
        ProviderConfig {
            model: json_config.model.clone(),
            custom_endpoint: json_config.custom_endpoint.clone(),
            region: json_config.region.clone(),
            max_steps: json_config.max_steps,
        },
    );
    json_config.last_provider = Some(json_config.provider.clone());

    write_config(&json_config)?;

    // サイドカーへ同期（キー + customEndpoint）。x-upstream 廃止後は
    // ここで設定した storedCustomEndpoint が /v1 プロキシの上流になる。
    // キーが設定されている場合のみ push する（削除時はスキップ）。
    if !actual_method.is_empty() {
        if let Some(key) = load_full_config_for_sidecar() {
            push_api_key_to_sidecar(&key);
        }
    }

    Ok(SaveKeyResult {
        method: actual_method,
    })
}

/// Load AI configuration.
///
/// Returns the config with `apiKey` set to empty string when the key is
/// stored in the OS keychain. The frontend uses `apiKeyConfigured` to
/// know a key exists.
///
/// If no config file exists, returns `None`.
#[tauri::command]
pub fn load_ai_config() -> Result<Option<AiConfig>, String> {
    let path = config_file_path()?;

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let mut config: AiConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;

    // 監査指摘対応 (2026-08-27): レガシー平文 api_key が config.json に残っている場合、
    // フロントへ返す前に空化する（キーの実体は keychain / credentials.json 側が本命。
    // フロントには apiKeyConfigured フラグのみを渡し、平文キーをレンダラーへ漏らさない。
    // ディスク上の平文は load_full_config_for_sidecar（ヘッドレス/CI フォールバック）が
    // 参照するため削除せず、表示層だけを安全化する）。
    if !config.api_key.is_empty() {
        log::warn!(
            "load_ai_config: legacy plaintext api_key found in config.json; \
             stripping before returning to frontend"
        );
        config.api_key_configured = true;
        config.api_key = String::new();
    }

    Ok(Some(config))
}

/// フロントエンドから呼ばれる: カスタムエンドポイントをサイドカーへ即時同期する。
///
/// 用途: AI 設定の保存前にモデル一覧を取得する場合（/v1/models）など、
/// 保存済み設定を /v1 プロキシの上流（storedCustomEndpoint）に反映する。
/// x-upstream ヘッダ廃止（H1）後の代替経路。
#[tauri::command]
pub fn sync_sidecar_config(endpoint: Option<String>) -> Result<(), String> {
    let key = load_full_config_for_sidecar().unwrap_or_default();
    let ep = match endpoint {
        Some(e) if !e.is_empty() => Some(e),
        _ => read_existing_config().and_then(|c| c.custom_endpoint),
    };
    push_api_key_to_sidecar_on_port(&key, ep.as_deref(), DEFAULT_SIDECAR_PORT);
    Ok(())
}

/// API キーを保存する（デスクトップ: OS キーチェーン → 失敗時は credentials.json）。
///
/// M2: 実際に保存された場所（"keychain" | "file"）を返し、UI が実態に
/// 合わせた表示（「OSキーチェーンに保存」/「設定ファイルに保存（平文）」）を
/// できるようにする。Web 版はこのコマンドが無いため IndexedDB にフォールバックする。
#[tauri::command]
pub fn save_api_key(provider: String, api_key: String) -> Result<SaveKeyResult, String> {
    if api_key.is_empty() {
        delete_api_key(provider.clone())?;
        return Ok(SaveKeyResult {
            method: String::new(),
        });
    }
    // デスクトップの既定はキーチェーン（利用不可時は自動でファイルへフォールバック）
    let method = save_key_to_storage(&api_key, &provider, "keychain")?;
    // サイドカー（メモリ内キーストア）へ同期
    push_api_key_to_sidecar(&api_key);
    Ok(SaveKeyResult { method })
}

/// API キーを読み込む（デスクトップ: OS キーチェーン → credentials.json）。
///
/// 2026-08-12: 指定 storage_method で読めない場合、逆メソッドも試す。
/// （save_api_key が file フォールバック時に storage_method を更新しないため、
/// キーチェーン利用不可環境では credentials.json のキーが読み戻せないバグの修正）
#[tauri::command]
pub fn load_api_key(provider: String) -> Result<Option<String>, String> {
    let method = read_existing_config()
        .map(|c| c.storage_method)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| "keychain".to_string());
    let key = load_key_from_storage(&provider, &method);
    if key.is_some() {
        return Ok(key);
    }
    let alt = if method == "keychain" { "file" } else { "keychain" };
    Ok(load_key_from_storage(&provider, alt))
}

/// API キーを削除する（keychain と credentials.json の両方）。
#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    delete_key_from_storage(&provider, "keychain");
    delete_key_from_storage(&provider, "file");
    Ok(())
}

// ── Per-provider config (multi-provider support in config.json) ───────────────

/// Save per-provider settings (model/customEndpoint/region/maxSteps) to config.json.
///
/// Desktop storage for `provider_config_{provider}` (previously IndexedDB — see
/// web-storage audit 2026-08-12). The flat fields mirror the saved provider so
/// existing readers (sidecar push, legacy config consumers) keep working.
#[tauri::command]
pub fn save_provider_config(provider: String, config: ProviderConfig) -> Result<(), String> {
    let mut existing = read_existing_config().unwrap_or_default();
    existing.providers.insert(provider.clone(), config.clone());
    existing.last_provider = Some(provider.clone());
    existing.provider = provider.clone();
    existing.model = config.model;
    existing.custom_endpoint = config.custom_endpoint.clone();
    existing.region = config.region.clone();
    existing.max_steps = config.max_steps;
    write_config(&existing)
}

/// Load per-provider settings for the given provider.
#[tauri::command]
pub fn load_provider_config(provider: String) -> Result<Option<ProviderConfig>, String> {
    Ok(read_existing_config().and_then(|c| c.providers.get(&provider).cloned()))
}

/// Save the most recently used provider name.
#[tauri::command]
pub fn save_last_provider(provider: String) -> Result<(), String> {
    let mut existing = read_existing_config().unwrap_or_default();
    existing.last_provider = Some(provider);
    write_config(&existing)
}

/// Load the most recently used provider name.
#[tauri::command]
pub fn load_last_provider() -> Result<Option<String>, String> {
    Ok(read_existing_config().and_then(|c| c.last_provider))
}

/// Save the currently open app id (was WebView localStorage).
///
/// `None`（フロントが `null` を渡した場合）は config.json から `current_app` を
/// 除去する（2026-08-27 監査指摘対応: アプリを閉じた際に null 同期が可能に）。
#[tauri::command]
pub fn save_current_app(app_id: Option<String>) -> Result<(), String> {
    let mut existing = read_existing_config().unwrap_or_default();
    existing.current_app = app_id;
    write_config(&existing)
}

/// Load the currently open app id.
#[tauri::command]
pub fn load_current_app() -> Result<Option<String>, String> {
    Ok(read_existing_config().and_then(|c| c.current_app))
}

// ── UI Settings (config.json persistence; was WebView localStorage) ───────────

/// Save UI settings (language/theme/font/simple mode) to config.json.
///
/// Desktop persistence for `deskspawn_settings` (previously WebView
/// localStorage — web-storage audit 2026-08-12 follow-up). Web keeps
/// localStorage via the frontend fallback; this command is only reachable
/// inside Tauri.
#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    // 入力検証: UI 由来の値を制限し、不正な config.json（手動編集や旧版の
    // 壊れた値）が書き込まれて以降の起動で UI が壊れるのを防ぐ
    // （2026-08-15・レビュー指摘対応）。
    validate_settings(&settings)?;
    let mut existing = read_existing_config().unwrap_or_default();
    existing.settings = Some(settings);
    write_config(&existing)
}

/// AppSettings の値が許可範囲内かを検証する。
/// LANGUAGES は packages/shared/src/lib/languages.ts の言語一覧と同期すること
/// （言語追加時はここも更新）。
fn validate_settings(s: &AppSettings) -> Result<(), String> {
    const THEMES: [&str; 3] = ["system", "light", "dark"];
    const LANGUAGES: [&str; 2] = ["ja", "en"];
    const MIN_FONT_SIZE: u32 = 8;
    const MAX_FONT_SIZE: u32 = 32;

    if !THEMES.contains(&s.theme.as_str()) {
        return Err(format!("Invalid theme: {}", s.theme));
    }
    if !LANGUAGES.contains(&s.language.as_str()) {
        return Err(format!("Invalid language: {}", s.language));
    }
    if !(MIN_FONT_SIZE..=MAX_FONT_SIZE).contains(&s.ui_font_size) {
        return Err(format!("Invalid uiFontSize: {}", s.ui_font_size));
    }
    if !(MIN_FONT_SIZE..=MAX_FONT_SIZE).contains(&s.code_font_size) {
        return Err(format!("Invalid codeFontSize: {}", s.code_font_size));
    }
    Ok(())
}

/// Load UI settings from config.json. `None` = never saved yet (first run) —
/// the desktop frontend then shows the language-select screen.
#[tauri::command]
pub fn load_settings() -> Result<Option<AppSettings>, String> {
    Ok(read_existing_config().and_then(|c| c.settings))
}

/// TEST ONLY: 現在の keyring service 名を返す（E2E のキーチェーン分離ガード用）。
/// E2E が本番キーチェーンを汚さないよう、アプリが
/// `DESKSPAWN_KEYCHAIN_SERVICE=com.deskspawn.e2e` 付きで起動されているかを
/// E2E beforeAll が検証する（2026-08-15 レビュー指摘対応）。
#[tauri::command]
pub fn get_keyring_service() -> Result<String, String> {
    Ok(keyring_service())
}

/// remove_dir_all を指数バックオフで再試行する（Windows のファイルハンドル解放遅延対策。
/// delete_app と同じ方針 — 実績 2026-08-15・E2E で「os error 32」頻発）。
/// 失敗時は最後のエラーを返す。
fn remove_dir_all_with_retry(dir: &std::path::Path) -> Result<(), String> {
    let mut last_err: Option<String> = None;
    for attempt in 0..6 {
        match fs::remove_dir_all(dir) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(format!("Failed to remove dir: {}", e));
                if attempt < 5 {
                    std::thread::sleep(std::time::Duration::from_secs(1 << attempt));
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| "Failed to remove dir".to_string()))
}

/// DEV/TEST ONLY: wipe all user app data so E2E starts from a clean state.
///
/// Deletes:
///   - app registry (`apps/apps.json`)
///   - all generated app directories (`apps/app-*`, incl. their `.deskspawn/`
///     chat DBs and checkpoints)
///   - UI state in config.json (`settings`, `current_app`)
/// Keeps: API keys (OS keychain / credentials.json) and AI provider config.
///
/// ⚠️ DANGER: this destroys real user data. Guard (required):
///   - environment variable `DESKSPAWN_TEST_RESET=1`
/// (No `cfg!(debug_assertions)` check: E2E runs against release-profile
/// builds (`cargo-tauri build`), so a debug-build guard would make the
/// command useless on the real machine. The env guard is the anti-footgun.)
/// E2E runs this in `beforeAll` — see `e2e/desktop.spec.ts` header comment.
#[tauri::command]
pub fn reset_app_data() -> Result<(), String> {
    if std::env::var("DESKSPAWN_TEST_RESET").as_deref() != Ok("1") {
        return Err(
            "reset_app_data requires the environment variable DESKSPAWN_TEST_RESET=1 \
             (guards against accidental data loss; E2E must run in a dev environment only)"
                .to_string(),
        );
    }

    log::warn!(
        "reset_app_data: DELETING app registry, app directories, settings, and current app. \
         API keys in the OS keychain are kept."
    );

    // 1. Registry (apps.json)
    let registry = workspace::apps_json_path()?;
    if registry.exists() {
        fs::remove_file(&registry).map_err(|e| format!("Failed to remove registry: {e}"))?;
    }

    // 2. Generated app directories (apps/app-*)
    let apps_dir = workspace::apps_dir()?;
    if apps_dir.exists() {
        if let Ok(entries) = fs::read_dir(&apps_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("app-") {
                    // Windows ではファイルハンドル解放に数十秒かかることがあり
                    // remove_dir_all が "os error 32" で失敗するため、delete_app と同じ
                    // 指数バックオフ（1+2+4+8+16 = 最大31秒待ち）で再試行する
                    // （2026-08-27 監査指摘対応・実績 2026-08-15 E2E）。
                    match remove_dir_all_with_retry(&entry.path()) {
                        Ok(()) => log::info!("reset_app_data: removed app dir {name}"),
                        Err(e) => log::error!("reset_app_data: failed to remove app dir {name}: {e}"),
                    }
                }
            }
        }
    }

    // 3. UI state in config.json (settings / current_app). AI provider config
    //    and API keys are intentionally kept (E2E AI-config tests reuse them).
    let mut existing = read_existing_config().unwrap_or_default();
    existing.settings = None;
    existing.current_app = None;
    write_config(&existing)?;

    log::warn!("reset_app_data: done. All app data deleted (keychain kept).");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join(format!(
            "deskspawn-ai-config-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var("DESKSPAWN_ROOT", &tmp);
        tmp
    }

    // ── is_within_profile（credentials.json プロファイル内ガード）──

    #[test]
    fn within_profile_accepts_real_default_path_windows() {
        // 実パスは ~/deskspawn/config/credentials.json（APPDATA 配下ではない）。
        // USERPROFILE 基準なら通過する（旧 APPDATA 基準では拒否されてしまう — 実績 2026-08-22）。
        assert!(is_within_profile(
            r"C:\Users\alice",
            r"C:\Users\alice\deskspawn\config\credentials.json"
        ));
        assert!(is_within_profile(
            "/home/alice",
            "/home/alice/deskspawn/config/credentials.json"
        ));
    }

    #[test]
    fn within_profile_rejects_appdata_and_sibling_prefix() {
        // APPDATA は別ディレクトリ → 拒否（旧実装がこれで正当パスを誤拒否していた）
        assert!(!is_within_profile(
            r"C:\Users\alice\AppData\Roaming",
            r"C:\Users\alice\deskspawn\config\credentials.json"
        ));
        // プレフィックスが似ていても別フォルダ（alice2）は拒否
        assert!(!is_within_profile(
            r"C:\Users\alice",
            r"C:\Users\alice2\deskspawn\config\credentials.json"
        ));
        // 完全に別の場所も拒否
        assert!(!is_within_profile(
            r"C:\Users\alice",
            r"D:\shared\credentials.json"
        ));
    }

    #[test]
    fn within_profile_handles_case_and_separators() {
        // 大文字小文字・\ と / の混在を吸収して一致判定する
        assert!(is_within_profile(
            r"c:\users\ALICE",
            r"C:\Users\alice\deskspawn\config\credentials.json"
        ));
        assert!(is_within_profile(
            "/home/alice",
            "/home/alice/deskspawn/config/credentials.json"
        ));
    }

    #[test]
    fn within_profile_empty_profile_is_rejected() {
        // プロファイル変数が空 = 判定不能 → 安全側（拒否）
        assert!(!is_within_profile("", "/tmp/x/credentials.json"));
    }

    #[test]
    fn settings_roundtrip() {
        let _guard = crate::engine::workspace::test_env_lock();
        let tmp = test_root("settings-roundtrip");

        // Not saved yet → None (first run / language not chosen)
        assert!(load_settings().unwrap().is_none());

        let s = AppSettings {
            theme: "dark".into(),
            ui_font_size: 16,
            code_font_size: 15,
            language: "en".into(),
            simple_mode: false,
        };
        save_settings(s.clone()).unwrap();

        let loaded = load_settings().unwrap().expect("settings saved");
        assert_eq!(loaded.language, "en");
        assert_eq!(loaded.theme, "dark");
        assert_eq!(loaded.ui_font_size, 16);
        assert_eq!(loaded.code_font_size, 15);
        assert!(!loaded.simple_mode);

        // Overwrite (updateSettings flow)
        save_settings(AppSettings { language: "ja".into(), ..s }).unwrap();
        assert_eq!(load_settings().unwrap().unwrap().language, "ja");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn save_settings_rejects_invalid_values() {
        let _guard = crate::engine::workspace::test_env_lock();
        let tmp = test_root("settings-validate");

        let base = AppSettings::default();
        // theme / language / font sizes の不正値は拒否
        assert!(save_settings(AppSettings { theme: "neon".into(), ..base.clone() }).is_err());
        assert!(save_settings(AppSettings { language: "fr".into(), ..base.clone() }).is_err());
        assert!(save_settings(AppSettings { ui_font_size: 4, ..base.clone() }).is_err());
        assert!(save_settings(AppSettings { code_font_size: 99, ..base.clone() }).is_err());
        // 境界値（8 / 32）は許可
        assert!(
            save_settings(AppSettings { ui_font_size: 8, code_font_size: 32, ..base }).is_ok()
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn keyring_service_respects_env_override() {
        // デフォルト（env 未設定）は本番 service
        std::env::remove_var("DESKSPAWN_KEYCHAIN_SERVICE");
        assert_eq!(keyring_service(), "com.deskspawn");
        // E2E 用に env を設定すると service 名が切り替わる
        std::env::set_var("DESKSPAWN_KEYCHAIN_SERVICE", "com.deskspawn.e2e");
        assert_eq!(keyring_service(), "com.deskspawn.e2e");
        std::env::remove_var("DESKSPAWN_KEYCHAIN_SERVICE");
    }

    #[test]
    fn reset_app_data_requires_env_guard() {
        let _guard = crate::engine::workspace::test_env_lock();
        let tmp = test_root("reset-guard");

        std::env::remove_var("DESKSPAWN_TEST_RESET");
        let err = reset_app_data().unwrap_err();
        assert!(
            err.contains("DESKSPAWN_TEST_RESET"),
            "expected env-guard error, got: {err}"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn reset_app_data_cleans_apps_and_ui_state() {
        let _guard = crate::engine::workspace::test_env_lock();
        let tmp = test_root("reset-apps");
        std::env::set_var("DESKSPAWN_TEST_RESET", "1");

        // Setup: config.json with settings + current_app, registry, one app dir
        save_settings(AppSettings::default()).unwrap();
        save_current_app(Some("app-1234567890abcdef1234567890abcdef".into())).unwrap();

        let apps_json = workspace::apps_json_path().unwrap();
        std::fs::create_dir_all(apps_json.parent().unwrap()).unwrap();
        std::fs::write(&apps_json, "[]").unwrap();
        let app_dir = workspace::apps_dir()
            .unwrap()
            .join("app-1234567890abcdef1234567890abcdef");
        std::fs::create_dir_all(&app_dir).unwrap();
        std::fs::write(app_dir.join("package.json"), "{}").unwrap();

        reset_app_data().unwrap();

        // Registry + app dirs gone, UI state (settings/current_app) cleared,
        // AI provider config untouched (read_existing_config still parses).
        assert!(!apps_json.exists(), "registry should be removed");
        assert!(!app_dir.exists(), "app dir should be removed");
        let cfg = read_existing_config().expect("config.json still exists");
        assert!(cfg.settings.is_none());
        assert!(cfg.current_app.is_none());

        std::env::remove_var("DESKSPAWN_TEST_RESET");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
