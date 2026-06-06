# Getting Started with DeskSpawn

DeskSpawn is an AI-powered desktop application for building Windows-native applications
through natural language conversations. Describe what you want, and DeskSpawn generates
the code, creates the project, and lets you preview the result — all from a single
desktop app.

> **Current status:** DeskSpawn is in early development. Feedback and contributions
> are welcome on [GitHub](https://github.com/shira022/deskspawn).

---

## Quick Start

### 1. Download and Install

Grab the latest installer for your operating system from the
[releases page](https://github.com/shira022/deskspawn/releases/latest):

| Platform | Download | Install Instructions |
|----------|----------|----------------------|
| Windows  | `.msi`   | Run the installer   |
| macOS    | N/A      | Build from source ([instructions](./installation.md#macos)) |
| Linux    | `.deb` or `.AppImage` | See [installation guide](./installation.md) |

> **macOS note:** Pre-built `.dmg` installers are paused due to the cost of
> Apple's code signing certificate. See the [installation guide](./installation.md#macos)
> for building from source.

For detailed platform-specific install steps, visit the
[Installation guide](./installation.md).

### 2. Launch DeskSpawn

Once installed, open DeskSpawn from your applications menu or dock.

- **First launch** may take a moment as the app initialises its local database and
  starts the AI sidecar process.
- You may see a firewall or security prompt the first time — allow the connection
  so the sidecar can operate.

### 3. Configure Your AI Provider

DeskSpawn uses your own API keys to power its AI features.

1. Open **Settings** from the sidebar.
2. Under **AI Provider**, enter your API key (e.g. OpenAI, Anthropic, or a
   local Ollama endpoint).
3. Click **Save** — the sidecar will verify the connection automatically.

> You can also run entirely locally with [Ollama](https://ollama.ai) — no API key
> needed. See [AI Features](./usage/ai-features.md) for details.

### 4. Create Your First Project

1. Click **+ New Project** on the dashboard.
2. Give your project a name.
3. Describe the app you want to build (e.g. _"A calculator with a dark theme"_).
4. Hit **Generate** — DeskSpawn will build the project and open it in the preview.

---

## Prerequisites

- **Windows:** Windows 10 or later
- **macOS:** macOS 10.15 (Catalina) or later
- **Linux:** Ubuntu 20.04+ or equivalent (see [Installation](./installation.md))
- **Internet connection** for downloading the app and for cloud AI providers
  (not required when using a local Ollama setup)
- **~500 MB** free disk space

---

## Next Steps

- [Installation Guide](./installation.md) — detailed platform-specific setup
- [Managing Projects](./usage/projects.md) — create, open, and organise projects
- [AI Features](./usage/ai-features.md) — configure providers and use the AI assistant
- [Sidecar Architecture](./usage/sidecar.md) — how the AI runtime works under the hood
- [Changelog](./changelog.md) — release history and updates
