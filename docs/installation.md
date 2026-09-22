# Installation

DeskSpawn is a **desktop application** (Windows-first) with a browser-based demo
for evaluation. For real work, install or build the desktop app.

---

## Which path should I take?

| Path | Best for | Requirements |
|------|----------|--------------|
| **1. Installer** | Most users | None |
| **2. Bootstrap script** | Building from source, macOS, or unsupported setups | Git + ~2 GB free disk for the toolchain |
| **3. Web demo** | A quick look | A Chromium-based browser |

---

## 1. Installer

### System Requirements

| Component | Requirement |
|-----------|-------------|
| OS | **Windows 10** or **Windows 11** (Linux packages are also published) |
| WebView2 | Preinstalled on Windows 11; on Windows 10 it is installed automatically |
| RAM | 4 GB minimum (8 GB recommended) |
| Disk | ~200 MB for the app, plus space for your generated apps |
| Network | Only needed for AI API calls (preview runs fully offline) |

### Install

1. Download the latest installer from
   [GitHub Releases](https://github.com/shira022/deskspawn/releases):
   - Windows: `.msi` or the NSIS `-setup.exe`
   - Linux: `.deb` or `.AppImage` (AppImage requires FUSE)
2. Run the installer and follow the setup wizard.
3. Launch **DeskSpawn** from the Start menu (or your application menu).

> ⚠️ **The installers are unsigned.** Windows SmartScreen may show a warning on
> first run — choose "More info" → "Run anyway" if you trust the source.
>
> ⚠️ **macOS installers are not published.** Distributing a macOS build requires a
> paid Apple code-signing certificate (Gatekeeper rejects unsigned apps). On macOS,
> use the bootstrap script below — building from source needs no signing.

### Updates

At startup the app checks the configured update endpoint
(`https://shira022.github.io/deskspawn/updates.json`) in the background and logs
the result — it does not show a dialog. If the endpoint is not published yet (or
is unreachable), the check fails and the app only logs a warning; it never blocks
startup. You can always download the newest installer manually from
[GitHub Releases](https://github.com/shira022/deskspawn/releases).

> 📝 **Microsoft Store**: a Store listing is planned. Once published, you will also
> be able to install DeskSpawn from the Microsoft Store — the Store build is what
> removes the SmartScreen warning.

---

## 2. Bootstrap script (build from source)

One command detects the toolchain, tells you what it will install, clones or
updates the repository, and builds the app. It is **idempotent** — re-running only
does the missing work.

### Windows (PowerShell)

```powershell
git clone https://github.com/shira022/deskspawn.git
cd deskspawn
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
```

### Linux / macOS

```bash
git clone https://github.com/shira022/deskspawn.git
cd deskspawn
scripts/bootstrap.sh
```

### Options

The flag spelling differs by shell: on Linux/macOS use the POSIX `--flag` form,
on Windows use PowerShell's single-dash `-Flag` form (PowerShell does **not**
understand `--ref` and would bind it positionally).

| POSIX (`bootstrap.sh`) | PowerShell (`bootstrap.ps1`) | Default | Meaning |
|------|------|---------|---------|
| `--ref <branch\|tag>` | `-Ref <branch\|tag>` | `main` | Git ref to check out |
| `--dir <path>` | `-Dir <path>` | `~/deskspawn-src` | Where to clone when run **outside** a checkout |
| `--no-bundle` | `-NoBundle` | off | Faster build without installers (binary only) |
| `--dev` | `-Dev` | off | Prepare everything, then print the `tauri dev` command |
| `--skip-deps` | `-SkipDeps` | off | Do not detect or install prerequisites (CI / advanced) |

Run with `--help` (POSIX) or `-Help` (PowerShell) for the full list.

### What it installs (and how much disk it needs)

| Component | When | Approx. disk |
|-----------|------|--------------|
| Git | if missing | ~50 MB |
| Node.js 22 | if missing or < 20 | ~120 MB |
| pnpm | via `corepack enable` | — |
| Bun 1.3.14 | if missing | ~90 MB |
| Rust (rustup, minimal profile) | if missing | ~300 MB |
| Tauri CLI (`cargo install tauri-cli --locked`) | cargo-override path only, if `cargo tauri` is missing | a few hundred MB (compiles from source) |
| Linux native deps (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, …) | Debian/Ubuntu only, if missing | ~250 MB |
| VS Build Tools (C++ workload) | **never installed automatically** | ~2–6 GB if you install it |

> ⚠️ **VS Build Tools are never installed for you.** They require elevation and a
> large download, so the script only *detects* them and prints the link:
> <https://visualstudio.microsoft.com/visual-cpp-build-tools/> — select the
> **Desktop development with C++** workload.

> ⚠️ On Debian/Ubuntu the script uses `sudo` **only** if you already have
> passwordless sudo (`sudo -n true`). Otherwise it prints the exact `apt-get`
> command for you to run yourself instead of hanging on a password prompt.

### Where your data lives (the script never touches it)

The bootstrap script only works inside the source checkout. Your app data lives
separately:

- Windows: `%USERPROFILE%\deskspawn\`
- Linux / macOS: `~/deskspawn/`

### Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `beforeBuildCommand ... failed with exit code 1` and `'pnpm' is not recognized` | The Tauri config's `beforeBuildCommand` shells out to pnpm. Install Node + pnpm (the bootstrap script does this), or use the `cargo tauri build --no-bundle --config <override>` path with `{"build":{"beforeBuildCommand":""}}` after building the frontend yourself. |
| `resource path binaries\deskspawn-sidecar-... doesn't exist` | The sidecar binary is not committed and must be built first: `cd apps/desktop && bun scripts/build-sidecar.mjs`. |
| Cargo build fails with `os error 4551` / "application control policy" | Smart App Control is blocking unsigned build scripts. Turn it off in Windows Security → App & browser control → Smart App Control (irreversible — see [SECURITY.md](../SECURITY.md)). |
| `Command <name> not found` on the first screen, app frozen | The Rust side is missing an `invoke` implementation for that command — the build succeeded but the binary is stale. Rebuild from the current source. |
| Windows: `failed to remove file ... (os error 5)` during build | A running DeskSpawn instance still holds the executable. Stop it (`Get-Process | Where-Object { $_.ProcessName -match 'deskspawn' } | Stop-Process -Force`) and rebuild. |

---

## 3. Web Version (evaluation only)

The web version lets you try DeskSpawn in your browser without installing
anything.

### Browser Requirements

| Browser | Status |
|---------|--------|
| **Chrome 105+** | ✅ Fully supported (recommended) |
| **Edge 105+** | ✅ Fully supported |
| **Opera 91+** | ✅ Fully supported |
| **Firefox / Safari** | ⚠️ Limited — the preview (WebContainer) requires Chromium |

> ⚠️ **The web version is for evaluation only.** API keys and app data are
> stored in the browser (IndexedDB), which is less secure than the desktop
> app (OS keychain + local storage). For serious work, use the desktop app.

---

## Developer setup (manual)

If you prefer to drive the build yourself instead of using the bootstrap script,
see [CONTRIBUTING.md](../CONTRIBUTING.md) for the full development setup. The short
version:

```bash
git clone https://github.com/shira022/deskspawn.git
cd deskspawn
pnpm install

# Desktop app: the sidecar binary (externalBin) must exist before the Rust build
cd apps/desktop && bun scripts/build-sidecar.mjs && cd ../..

# Web app (dev server on http://localhost:5173)
pnpm dev

# Desktop app (Tauri dev mode)
pnpm --filter desktop tauri dev
```

Building the Windows installer from source requires Rust (MSVC) and the VS Build
Tools on Windows — see [CONTRIBUTING.md](../CONTRIBUTING.md).
