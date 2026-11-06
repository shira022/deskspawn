use std::path::PathBuf;

#[cfg(windows)]
const BUN_EXE: &str = "bun.exe";
#[cfg(not(windows))]
const BUN_EXE: &str = "bun";

/// Return the first candidate that exists on disk, preserving order.
pub fn pick_first_existing(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|candidate| candidate.exists())
}

/// Resolve the Bun executable used to run previews.
///
/// Resolution order:
///   1. `BUN_PATH`
///   2. bundled binary next to the current executable
///   3. `PATH` lookup (`where` / `which`)
///   4. `~/.bun/bin/bun[.exe]`
///   5. WinGet links (Windows only)
///   6. `~/dev/tools/bun/bun-windows-x64/bun.exe` (Windows dev fallback)
///
/// Paths are intentionally never logged; callers may only report a source
/// kind (bundled|env|path|home) if they need to.
pub fn resolve_bun_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(value) = std::env::var("BUN_PATH") {
        if !value.trim().is_empty() {
            candidates.push(PathBuf::from(value));
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(BUN_EXE));
        }
    }

    if let Some(found) = find_on_path() {
        candidates.push(found);
    }

    if let Some(home) = home_dir() {
        candidates.push(home.join(".bun").join("bin").join(BUN_EXE));
    }

    #[cfg(windows)]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(local_app_data)
                    .join("Microsoft")
                    .join("WinGet")
                    .join("Links")
                    .join("bun.exe"),
            );
        }
        if let Some(home) = home_dir() {
            candidates.push(
                home.join("dev")
                    .join("tools")
                    .join("bun")
                    .join("bun-windows-x64")
                    .join("bun.exe"),
            );
        }
    }

    pick_first_existing(candidates)
}

fn find_on_path() -> Option<PathBuf> {
    let command = if cfg!(windows) { "where" } else { "which" };
    let output = std::process::Command::new(command)
        .arg("bun")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first = stdout.lines().next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(PathBuf::from(first))
    }
}

#[cfg(windows)]
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

#[cfg(not(windows))]
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_path(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "deskspawn-bun-{}-{}-{}",
            std::process::id(),
            nanos,
            label
        ))
    }

    #[test]
    fn picks_the_first_existing_candidate() {
        let missing = unique_path("missing");
        let existing = unique_path("existing");
        fs::write(&existing, b"").expect("create temp file");

        let picked = pick_first_existing(vec![missing, existing.clone()]);

        fs::remove_file(&existing).ok();
        assert_eq!(picked, Some(existing));
    }

    #[test]
    fn returns_none_when_no_candidate_exists() {
        let missing = unique_path("none");
        assert_eq!(pick_first_existing(vec![missing]), None);
    }

    #[test]
    fn preserves_candidate_order() {
        let first = unique_path("first");
        let second = unique_path("second");
        fs::write(&first, b"").expect("create first temp file");
        fs::write(&second, b"").expect("create second temp file");

        let picked = pick_first_existing(vec![first.clone(), second.clone()]);

        fs::remove_file(&first).ok();
        fs::remove_file(&second).ok();
        assert_eq!(picked, Some(first));
    }
}
