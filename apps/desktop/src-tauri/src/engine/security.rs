use std::path::Path;

/// Shell command allowlist. Only commands matching these patterns are permitted.
const ALLOWED_COMMANDS: &[&str] = &[
    "npm install",
    "npm run",
    "npx ",
];

/// Check whether a command string is in the allowlist.
pub fn is_command_allowed(command: &str) -> bool {
    let trimmed = command.trim();
    ALLOWED_COMMANDS
        .iter()
        .any(|allowed| trimmed.starts_with(allowed))
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
const FORBIDDEN_TS_PATTERNS: &[&str] = &[
    "eval(",
    "new Function(",
    "document.write(",
    ".innerHTML",
    "fetch(",
    "XMLHttpRequest",
    "require(",
    "process.env",
    "child_process",
    "exec(",
    "execSync(",
    "spawn(",
    "spawnSync(",
];

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
        assert!(check_typescript_security("eval('alert(1)')").is_err());
    }
}
