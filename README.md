<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/DeskSpawn-ai--powered%20web%20app%20generator-8b5cf6?style=for-the-badge&labelColor=1e1b4b">
    <img src="https://img.shields.io/badge/DeskSpawn-ai--powered%20web%20app%20generator-8b5cf6?style=for-the-badge&labelColor=ede9fe" alt="DeskSpawn">
  </picture>
</p>

<p align="center">
  <b>AI-powered web app generation platform</b> — Describe your app in natural language, and DeskSpawn builds it in the browser.
</p>

<p align="center">
  <a href="https://deskspawn.pages.dev">
    <img src="https://img.shields.io/badge/Try%20Now-Cloudflare%20Pages-380d9f?style=flat-square&logo=cloudflare&logoColor=white" alt="Try Now">
  </a>
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

## What is DeskSpawn?

DeskSpawn is an **AI-powered web app development platform that runs entirely in your browser.** No backend server, no installation — just open the app, enter your API key, and describe what you want to build.

It uses a **multi-agent AI pipeline** to plan, write code, verify, and iterate on your app, then runs a live preview via [WebContainer](https://webcontainers.io/) so you can see the result immediately.

### Use Cases

- **Rapid prototyping**: Go from idea to working prototype in minutes
- **Learning**: See how AI builds React apps step by step
- **Iteration**: Describe changes in natural language, watch the code update in real time
- **Export**: Download your project as a complete React + TypeScript + Tailwind CSS codebase

---

## ✨ Features

- **🤖 Multi-Agent AI Pipeline** — Triage → Planner → Coder → Verifier → Visual QA agents collaborate to build your app
- **🔌 Multi-Provider AI** — Supports OpenAI, Anthropic Claude, Google Gemini, AWS Bedrock, Azure OpenAI, GCP Vertex AI, Ollama, and any OpenAI-compatible endpoint
- **🖥️ Live Preview** — Built-in WebContainer runs your generated app in a sandboxed Node.js environment
- **📁 Project Management** — Save, switch between, and restore past projects with IndexedDB/OPFS storage
- **🌐 i18n Support** — English and Japanese interfaces (locale system is extensible)
- **🔒 Privacy First** — Your API keys stay in your browser. DeskSpawn does not have a backend server
- **📦 Export** — Download your project as a ZIP archive

---

## 🚀 Quick Start

### Try it Online

Visit **[deskspawn.pages.dev](https://deskspawn.pages.dev)** (once deployed):

1. Select your language
2. Enter your AI provider API key (OpenAI, Anthropic, etc.)
3. Describe the web app you want to build
4. Watch DeskSpawn plan, code, and preview your app in real time

> **Note**: Your API key stays in your browser's IndexedDB. DeskSpawn communicates directly with your chosen AI provider — no intermediate server.

### Browser Requirements

| Feature | Required For |
|---|---|
| **Chrome 105+ / Edge 105+** | WebContainer (preview) |
| **Cross-Origin Isolation** | SharedArrayBuffer (WebContainer) |
| **IndexedDB** | Data persistence |
| **Web Crypto API** | Not yet used for encryption, checked for future use |

> Safari and Firefox have limited WebContainer support. Chrome-based browsers are recommended.

---

## 🛠️ Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/shira022/deskspawn.git
cd deskspawn

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The dev server will start at `http://localhost:5173`. It automatically serves COOP/COEP headers required by WebContainer.

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview production build locally |
| `npm test` | Run unit tests |
| `npm run test:ui` | Run UI component tests |
| `npm run lint` | Run ESLint |

### Project Structure

```
deskspawn/
├── src/                        # Main application
│   ├── App.tsx                 # Root component
│   ├── main.tsx                # Entry point + boot sequence
│   ├── engine/                 # Multi-agent AI pipeline
│   │   ├── orchestrator.ts     # Agent orchestration
│   │   ├── triage.ts           # Request triage
│   │   ├── tools.ts            # AI tool definitions
│   │   ├── tool-executors.ts   # Tool execution logic
│   │   ├── providers.ts        # AI provider resolution
│   │   └── system-prompts/     # Agent prompt templates
│   ├── lib/                    # Utilities
│   │   ├── storage.ts          # IndexedDB layer
│   │   ├── storage-opfs.ts     # OPFS file storage
│   │   ├── preview/            # WebContainer management
│   │   ├── compatibility.ts    # Browser feature detection
│   │   └── i18n.ts             # Internationalization
│   ├── store/                  # Zustand state management
│   ├── components/             # UI components
│   │   ├── ui/                # Base primitives (shadcn-style)
│   │   ├── chat/              # Chat panel, messages
│   │   ├── preview/           # Live preview panel
│   │   ├── file-tree/         # File explorer
│   │   └── settings/          # Configuration dialogs
│   ├── routes/                 # Routing (landing + app)
│   ├── locales/                # i18n translations
│   └── hooks/                  # Custom React hooks
├── public/                     # Static assets
│   └── _headers                # Cloudflare Pages security headers
└── .github/workflows/          # CI pipeline
```

---

## ☁️ Self-Hosting

DeskSpawn is designed to be deployed as a static site. The recommended hosting platform is **Cloudflare Pages** (WebContainer requires COOP/COEP headers, which Cloudflare Pages supports via `_headers`).

### Deploy to Cloudflare Pages

1. Fork this repository on GitHub
2. Go to [Cloudflare Pages dashboard](https://dash.cloudflare.com/?to=/:account/pages)
3. Click **Create a project** → **Connect to Git**
4. Select your fork and configure:
   - **Project name**: `deskspawn`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
5. Deploy

The security headers in `public/_headers` will automatically apply:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`
- Content Security Policy
- `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`

### Other Hosting Options

| Platform | COOP/COEP Support | Notes |
|---|---|---|
| **Cloudflare Pages** | ✅ `_headers` file | Recommended |
| **Vercel** | ✅ `vercel.json` | Pro plan required for commercial use |
| **Netlify** | ✅ `netlify.toml` | 100 GB bandwidth cap on free tier |
| **GitHub Pages** | ❌ No custom headers | WebContainer preview will not work |

---

## 🔒 Security

DeskSpawn's security model differs from typical web apps because **it has no backend server**.

### Architecture

```
Your Browser ────→ AI Provider API (OpenAI, Anthropic, etc.)
      │
      ├── IndexedDB/OPFS (project data, API keys)
      ├── WebContainer (generated app preview, sandboxed)
      └── Local Storage (settings, preferences)
```

- **No data leaves your browser** except API requests to your chosen AI provider
- **API keys are stored client-side** in IndexedDB. They are not sent to any server other than the AI provider you configure
- **Generated apps run in WebContainer**, a sandboxed Node.js environment that cannot access the host page's data
- **CSP headers** restrict script execution, connection targets, and resource loading
- **iframe sandbox** restricts the preview panel's capabilities

### Reporting Vulnerabilities

See [SECURITY.md](SECURITY.md) for our coordinated disclosure process.

---

## 🧩 Tech Stack

| Layer | Technology |
|---|---|
| **UI Framework** | React 18 + TypeScript |
| **Build Tool** | Vite 6 |
| **Styling** | Tailwind CSS 4 |
| **State Management** | Zustand |
| **AI SDK** | Vercel AI SDK (`ai` + provider packages) |
| **Preview Runtime** | WebContainer API |
| **Storage** | IndexedDB / OPFS |
| **Internationalization** | i18next + react-i18next |
| **Testing** | Vitest + Testing Library |

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, branch strategy, and code style.

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 📄 License

[MIT](LICENSE) © DeskSpawn
