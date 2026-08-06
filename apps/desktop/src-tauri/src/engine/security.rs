use std::path::Path;
use std::sync::OnceLock;

/// ローカルHTTPサーバー（サイドカー / security_server）の共有認証トークン。
///
/// アプリ起動時に一度だけ生成される（256bit hex）。Rust が生成し、
/// - サイドカーには環境変数 DESKSPAWN_AUTH_TOKEN で渡す
/// - security_server はリクエストヘッダ X-DeskSpawn-Token で検証する
/// - Rust → サイドカーへの内部呼び出し（/api/config 等）にも付与する
///
/// 目的: ブラウザタブ（任意オリジン）やローカルプロセスからの
/// 無認証アクセスを防ぐ。トークンは WebView 内 JS からも取得可能だが、
/// Tauri IPC（invoke）経由のため外部オリジンの Web ページからは到達できない。
static AUTH_TOKEN: OnceLock<String> = OnceLock::new();

/// 認証トークンを生成してグローバルに保持する（初回のみ生成、以後は既存値を返す）。
pub fn init_auth_token() -> String {
    AUTH_TOKEN
        .get_or_init(|| {
            let token = format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            );
            log::info!("Auth token initialized ({} hex chars)", token.len());
            token
        })
        .clone()
}

/// 現在の認証トークンを返す（未初期化なら None）。
pub fn auth_token() -> Option<String> {
    AUTH_TOKEN.get().cloned()
}

/// npx で実行を許可するツール（バイナリ名）。生成アプリのビルド/検証に必要なもののみ。
const ALLOWED_NPX_TOOLS: &[&str] = &[
    "tsc",
    "tsserver",
    "vite",
    "tailwindcss",
    "eslint",
    "prettier",
    "vitest",
    "tsx",
];

/// Check whether a command string is in the allowlist.
///
/// Security: `npx <任意パッケージ>` による任意コード実行を防ぐため、
/// npx の直後のパッケージ名を ALLOWED_NPX_TOOLS で検証する。
/// （npm install / npm run は --ignore-scripts 付与 or 生成アプリの scripts 実行のため許可）
pub fn is_command_allowed(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.starts_with("npm install") {
        return true;
    }
    if trimmed.starts_with("npm run") {
        return true;
    }
    if let Some(rest) = trimmed.strip_prefix("npx ") {
        return is_npx_package_allowed(rest);
    }
    false
}

/// npx の引数部分から実行対象パッケージ名を抽出して検証する。
/// 例: "tsc --noEmit" → "tsc" / "-y tsc" → "tsc" / "evil-pkg" → 拒否
fn is_npx_package_allowed(npx_args: &str) -> bool {
    for tok in npx_args.split_whitespace() {
        if tok.starts_with('-') {
            continue; // フラグ（-y, --yes 等）はスキップ
        }
        // バージョン指定（tsc@5.0）はパッケージ名部分だけ取り出す
        let name = tok.split('@').next().unwrap_or(tok);
        return ALLOWED_NPX_TOOLS.contains(&name);
    }
    false
}

/// Validate that `target` is strictly inside `workspace` (no ../ traversal).
pub fn is_path_safe(workspace: &Path, target: &Path) -> bool {
    let canonical_workspace = match workspace.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let canonical_target = match target.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // If the target doesn't exist yet, resolve it relative to workspace
            let abs = if target.is_absolute() {
                target.to_path_buf()
            } else {
                workspace.join(target)
            };
            match abs.canonicalize() {
                Ok(p) => p,
                Err(_) => {
                    // Still doesn't exist; do a prefix check on the non-canonical path
                    let abs_normalized = normalize_path(&abs);
                    let ws_normalized = normalize_path(workspace);
                    return abs_normalized.starts_with(&ws_normalized);
                }
            }
        }
    };
    canonical_target.starts_with(canonical_workspace)
}

/// Normalize a path by removing redundant components.
fn normalize_path(path: &Path) -> std::path::PathBuf {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(c) => components.push(c),
            std::path::Component::ParentDir => {
                components.pop();
            }
            _ => {}
        }
    }
    let mut result = std::path::PathBuf::new();
    for c in components {
        result.push(c);
    }
    result
}

/// Validate that a file extension is in the allowed list for writing.
pub fn is_extension_allowed(path: &str) -> bool {
    let allowed_extensions = &[
        "tsx", "ts", "jsx", "js", "css", "html", "json", "toml",
        "md", "yaml", "yml", "env", "env.example", "gitignore", "prettierrc",
        "eslintrc", "babelrc", "mjs", "cjs", "mts", "cts", "d.ts",
        "txt", "csv", "svg", "xml",
    ];

    let p = Path::new(path);
    let ext = match p.extension() {
        Some(e) => e.to_str().unwrap_or(""),
        None => "",
    };

    // Special case for dotfiles like .gitignore, .env, etc.
    if ext.is_empty() {
        if let Some(name) = p.file_name() {
            let name_str = name.to_str().unwrap_or("");
            return name_str.starts_with('.');
        }
        return false;
    }

    allowed_extensions.contains(&ext)
}

/// Validate npm package name against whitelist (React + Vite + TypeScript).
pub fn is_package_allowed(pkg_name: &str) -> bool {
    let allowed_packages = &[
        "react",
        "react-dom",
        "typescript",
        "vite",
        "tailwindcss",
        "zustand",
        "lucide-react",
        "clsx",
        "tailwind-merge",
        "react-resizable-panels",
        "@vitejs/plugin-react",
        "@types/react",
        "@types/react-dom",
    ];
    allowed_packages.contains(&pkg_name)
}

/// Sanitize npm install command by adding --ignore-scripts.
pub fn sanitize_npm_install(command: &str) -> String {
    let trimmed = command.trim();
    if trimmed.starts_with("npm install") && !trimmed.contains("--ignore-scripts") {
        // Insert --ignore-scripts after the install subcommand
        let rest = trimmed.trim_start_matches("npm install");
        format!("npm install {} --ignore-scripts", rest.trim())
    } else {
        command.to_string()
    }
}

/// Forbidden TypeScript/JavaScript API patterns.
///
/// 危険な実行/コード生成系のみを対象とする（fetch 等の正当な API 呼び出しは
/// 生成アプリで一般的なため許可）。
const FORBIDDEN_TS_PATTERNS: &[&str] = &[
    "eval(",
    "new Function(",
    "document.write(",
    ".innerHTML",
    "child_process",
    "exec(",
    "execSync(",
    "spawn(",
    "spawnSync(",
];

/// 生成コードのセキュリティ検証対象となる拡張子かどうか。
pub fn is_typescript_file(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts")
}

/// Check TypeScript/JavaScript code for forbidden APIs.
/// Returns Ok(()) if safe, or Err with list of violations.
pub fn check_typescript_security(code: &str) -> Result<(), Vec<String>> {
    let violations: Vec<String> = FORBIDDEN_TS_PATTERNS
        .iter()
        .filter(|&&pattern| code.contains(pattern))
        .map(|&pattern| format!("Forbidden TypeScript API pattern found: {}", pattern))
        .collect();

    if violations.is_empty() {
        Ok(())
    } else {
        Err(violations)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_command_allowed() {
        assert!(is_command_allowed("npm install react"));
        assert!(is_command_allowed("npm run build"));
        assert!(is_command_allowed("npx tsc --noEmit"));
        assert!(is_command_allowed("npx -y tsc"));
        assert!(is_command_allowed("npx tsc@5.4.2 --noEmit"));
        assert!(is_command_allowed("npx vite build"));
        assert!(!is_command_allowed("npx evil-package"));
        assert!(!is_command_allowed("npx @scope/evil-package"));
        assert!(!is_command_allowed("npx"));
        assert!(!is_command_allowed("rm -rf /"));
        assert!(!is_command_allowed("curl http://evil.com"));
        assert!(!is_command_allowed("sudo apt install"));
        assert!(!is_command_allowed("cargo check"));
        assert!(!is_command_allowed("sqlx migrate run"));
    }

    #[test]
    fn test_is_extension_allowed() {
        assert!(is_extension_allowed("src/App.tsx"));
        assert!(is_extension_allowed(".gitignore"));
        assert!(!is_extension_allowed("malware.exe"));
        assert!(!is_extension_allowed("script.bat"));
        assert!(!is_extension_allowed("src/lib.rs"));
        assert!(!is_extension_allowed("schema.sql"));
    }

    #[test]
    fn test_check_typescript_security() {
        assert!(check_typescript_security("const x = 1;").is_ok());
        assert!(check_typescript_security("eval('alert(1)'").is_err());
        assert!(check_typescript_security("new Function('return 1')").is_err());
        assert!(check_typescript_security("document.write('<script>')").is_err());
        assert!(check_typescript_security("el.innerHTML = html").is_err());
        assert!(check_typescript_security("child_process.exec('rm -rf /')").is_err());
        // 正当なコード（fetch / require / process.env は生成アプリで一般的 → 許可）
        assert!(check_typescript_security("const res = await fetch('/api/data');").is_ok());
        assert!(check_typescript_security("import { useState } from 'react';").is_ok());
    }

    #[test]
    fn test_is_typescript_file() {
        assert!(is_typescript_file("src/App.tsx"));
        assert!(is_typescript_file("src/main.ts"));
        assert!(is_typescript_file("src/index.js"));
        assert!(is_typescript_file("src/utils.mjs"));
        assert!(!is_typescript_file("src/style.css"));
        assert!(!is_typescript_file("package.json"));
        assert!(!is_typescript_file("public/index.html"));
    }
}
