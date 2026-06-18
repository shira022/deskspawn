# Getting Started with DeskSpawn

DeskSpawn is an **AI-powered web app generation platform that runs entirely in your browser.**
Describe what you want to build, and DeskSpawn generates the code, creates the project,
and shows you a live preview — all without leaving your browser.

> **Current status:** DeskSpawn is in early development. Feedback and contributions
> are welcome on [GitHub](https://github.com/shira022/deskspawn).

---

## Quick Start

No installation is required. Everything runs in your browser.

### 1. Open DeskSpawn

Visit **[deskspawn.pages.dev](https://deskspawn.pages.dev)** (once deployed) or run
locally with `npm run dev`.

### 2. Configure Your AI Provider

DeskSpawn uses your own API keys to power its AI features.

1. On first launch, you'll be prompted to configure an AI provider
2. Enter your API key for one of the supported providers:
   - **OpenAI** — `https://api.openai.com` (requires a paid OpenAI account)
   - **Anthropic** — `https://api.anthropic.com` (Claude API)
   - **Google Gemini** — via Google AI Studio API key
   - **Ollama** — local, no API key needed (runs on your machine)
   - **AWS Bedrock, Azure OpenAI, GCP Vertex AI** — enterprise options
3. Your API key stays in your browser's IndexedDB — it is never sent to any
   server other than your chosen AI provider

> For a fully local setup, install [Ollama](https://ollama.ai) and configure
> DeskSpawn to use it as the provider.

### 3. Build Your First App

1. In the chat panel, describe the app you want to build
   - Example: _"A todo list app with a dark theme, add/delete tasks, and localStorage persistence"_
2. DeskSpawn's AI pipeline will:
   - **Plan** the architecture and file structure
   - **Write** all the code files
   - **Verify** the code compiles and runs
3. Once ready, a **live preview** will appear showing your app running in a
   sandboxed environment
4. Keep chatting to refine, add features, or fix issues

### 4. Export Your Project

Once you're happy with your app, you can:

- **Download ZIP** — get a complete Vite + React + TypeScript + Tailwind CSS project
- **Copy files** — manually copy individual files from the file tree panel

---

## Browser Compatibility

| Browser | Preview Support |
|---------|----------------|
| **Chrome 105+** | Full support (recommended) |
| **Edge 105+** | Full support |
| **Firefox** | Limited — preview (WebContainer) not available |
| **Safari** | Limited — preview (WebContainer) not available |

---

## Next Steps

- [Managing Projects](./usage/projects.md) — save, switch, and organise projects
- [AI Features](./usage/ai-features.md) — configure providers and use the AI assistant
- [Changelog](./changelog.md) — release history and updates
