**AI-powered desktop app development platform** — Build, manage, and deploy modern desktop applications with the power of AI. Leverages [Tauri v2](https://v2.tauri.app) for lightweight, secure, and cross-platform native apps.

<p align="center">
  <a href="https://github.com/shira022/deskspawn/releases">
    <img src="https://img.shields.io/github/v/release/shira022/deskspawn?style=flat-square&label=Release" alt="Release">
  </a>
  <a href="https://github.com/shira022/deskspawn/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/shira022/deskspawn/ci.yml?style=flat-square&label=CI" alt="CI">
  </a>
  <a href="https://github.com/shira022/deskspawn/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License">
  </a>
</p>

---

## Features

- **🤖 AI-Powered Development** — Leverage AI to generate, refactor, and optimize desktop applications.
- **🖥️ Cross-Platform** — Build once, deploy on Windows, macOS, and Linux with a single codebase.
- **📁 Project Management** — Organize projects with built-in templates, configuration management, and scaffolding.
- **⚙️ Sidecar Architecture** — Extend app capabilities with sidecar processes (Node.js, Python, or any binary).
- **🔄 Auto-Update** — Built-in Tauri updater for seamless application updates.
- **🔒 Secure by Default** — OS-level keychain integration for API key storage.

## Installation

### Windows

1. Download the latest `.msi` installer from the [Releases page](https://github.com/shira022/deskspawn/releases/latest).
2. Double-click the installer and follow the wizard.
3. Launch DeskSpawn from the Start Menu.

> **Note:** Windows SmartScreen may show a warning. Click **More info → Run anyway** to proceed.

### macOS

> **Note:** The macOS build distribution is currently paused due to the cost of Apple's code signing certificate. You can still build from source — see [Development](#development) below.

**To build from source on macOS:**
```bash
# Install prerequisites (Xcode Command Line Tools)
xcode-select --install

# Clone and build
git clone https://github.com/shira022/deskspawn.git
cd deskspawn
npm ci
npx tauri build
```

The built `.dmg` will be at `src-tauri/target/release/bundle/dmg/`.

### Linux

**AppImage:**
```bash
chmod +x DeskSpawn_*.AppImage
./DeskSpawn_*.AppImage
```

**Debian/Ubuntu (.deb):**
```bash
sudo dpkg -i DeskSpawn_*.deb
```

## Quick Start

1. Launch DeskSpawn.
2. Create a new project with **File → New Project**.
3. Choose a template or start from scratch.
4. Use the AI assistant (⌘+K / Ctrl+K) to generate code.
5. Build and preview with **Run → Build**.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/) (latest stable)
- Platform-specific dependencies:

  **Linux:**
  ```bash
  sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev \
    libappindicator3-dev librsvg2-dev patchelf \
    libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
  ```

  **macOS:** Xcode Command Line Tools
  ```bash
  xcode-select --install
  ```

  **Windows:** [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (included in Windows 10 1803+)

### Setup

```bash
# Clone the repository
git clone https://github.com/shira022/deskspawn.git
cd deskspawn

# Install frontend dependencies
npm install

# Install sidecar dependencies
cd sidecar && npm install && cd ..

# Build and run in development mode
npm run tauri:dev
```

### Project Structure

```
deskspawn/
├── src/                  # Frontend (React + TypeScript)
│   ├── components/       # Reusable UI components
│   ├── hooks/            # Custom React hooks
│   ├── stores/           # Zustand state stores
│   └── App.tsx           # Root component
├── src-tauri/            # Backend (Rust + Tauri)
│   ├── src/              # Rust source
│   ├── icons/            # App icons
│   └── tauri.conf.json   # Tauri configuration
├── sidecar/              # Sidecar server (TypeScript)
│   └── src/              # Server source
├── website/              # Marketing website (React + Vite)
│   └── src/pages/        # Website pages
└── .github/workflows/    # CI/CD pipelines
```

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run tauri:dev` | Start Tauri development mode |
| `npm run build` | Build frontend |
| `npx tauri build` | Build production app + bundles |
| `npm run sidecar` | Start sidecar server |
| `npm run lint` | Run ESLint |

## Building for Production

```bash
# Build the full application
npx tauri build
```

Output bundles are located in `src-tauri/target/release/bundle/`.

### Release Process

1. Update version in `package.json` and `src-tauri/Cargo.toml`.
2. Create a new release via GitHub Releases with a `v*` tag.
3. GitHub Actions automatically builds all platforms and deploys the website.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) © DeskSpawn Team
