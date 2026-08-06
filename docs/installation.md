# Installation

DeskSpawn is a **desktop application** (Windows) with a browser-based demo
for evaluation. For real work, install the desktop app.

---

## Desktop App (recommended)

### System Requirements

| Component | Requirement |
|-----------|-------------|
| OS | **Windows 10** or **Windows 11** |
| WebView2 | Preinstalled on Windows 11; on Windows 10 it is installed automatically |
| RAM | 4 GB minimum (8 GB recommended) |
| Disk | ~200 MB for the app, plus space for your generated apps |
| Network | Only needed for AI API calls (preview runs fully offline) |

### Install

1. Download the latest installer from
   [GitHub Releases](https://github.com/shira022/deskspawn/releases)
   (`.msi` or `.exe`/NSIS bundle).
2. Run the installer and follow the setup wizard.
3. Launch **DeskSpawn** from the Start menu.

> 🛒 **Microsoft Store**: a Store listing is planned. Once published, you will
> also be able to install DeskSpawn from the Microsoft Store.

### Updates

The desktop app checks for updates automatically and prompts you to install
them. You can also check manually from the app.

---

## Web Version (evaluation only)

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

## Developer Build (from source)

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full development setup.
Quick start:

```bash
git clone https://github.com/shira022/deskspawn.git
cd deskspawn
pnpm install

# Web app (dev server on http://localhost:5173)
pnpm dev

# Desktop app (Tauri dev mode)
pnpm --filter desktop tauri dev
```

Building the Windows installer from source requires Rust (MSVC) and the VS
Build Tools on Windows — see [CONTRIBUTING.md](../CONTRIBUTING.md).
