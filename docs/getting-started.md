# Getting Started with DeskSpawn

DeskSpawn is an **AI-powered app development platform**. Describe what you
want to build, and DeskSpawn generates the code, saves it as real files on
disk, and shows you a live preview — all locally on your machine.

The **desktop app** is the main product. A **browser demo** is available for
evaluation.

---

## Quick Start — Desktop App (recommended)

### 1. Install

Download the latest installer from
[GitHub Releases](https://github.com/shira022/deskspawn/releases) and run it.
See [Installation](./installation.md) for requirements.

### 2. Configure Your AI Provider

On first launch you'll be prompted to configure an AI provider:

1. Select your language.
2. Enter an API key for one of the supported providers:
   - **OpenAI** — `https://api.openai.com`
   - **Anthropic** — `https://api.anthropic.com`
   - **Google Gemini** — via Google AI Studio API key
   - **Ollama** — local, no API key needed (runs on your machine)
   - **AWS Bedrock, Azure OpenAI, GCP Vertex AI** — enterprise options
3. Your API key is stored in the **OS keychain** — it is never sent to any
   server other than the AI provider you choose (requests go through the
   local sidecar proxy).

> For a fully offline setup, install [Ollama](https://ollama.ai) and select it
> as the provider.

### 3. Build Your First App

1. Click **+ New App** in the toolbar and give your app a name.
2. In the chat panel, describe the app you want to build:
   - Example: _"A todo list app with a dark theme, add/delete tasks, and
     SQLite persistence"_
3. DeskSpawn's AI pipeline will:
   - **Plan** the architecture and file structure
   - **Write** all the code files (real files under `~/deskspawn/apps/`)
   - **Verify** the code compiles and its tests pass
4. A **live preview** appears — a local dev server running your app.
   Use the **open-in-browser** button to view it in your system browser.
5. Keep chatting to refine, add features, or fix issues.

### 4. Find Your Files

Your generated apps are real files at `~/deskspawn/apps/<app-id>/`. Open them
in any editor, or back them up by copying the folder.

---

## Quick Start — Web Version (evaluation)

1. Open the hosted web version in a Chromium-based browser (Chrome/Edge 105+).
2. Configure an AI provider (your key stays in the browser's IndexedDB).
3. Describe an app and watch it being generated in the sandboxed preview.

> ⚠️ **The web version is for evaluation only.** Data is stored in the browser
> (IndexedDB), which is less secure than the desktop app. For real work, use
> the desktop app.

---

## Browser Compatibility (web version)

| Browser | Preview Support |
|---------|----------------|
| **Chrome 105+** | Full support (recommended) |
| **Edge 105+** | Full support |
| **Firefox / Safari** | Limited — preview (WebContainer) not available |

---

## Next Steps

- [Managing Apps](./usage/apps.md) — create, switch, and organise apps
- [AI Features](./usage/ai-features.md) — configure providers and use the AI assistant
- [Changelog](./changelog.md) — release history and updates
