# Security Policy

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use GitHub's [private vulnerability reporting](https://github.com/shira022/deskspawn/security/advisories/new) feature.

### What to Include

- A clear description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact
- Any suggested fixes (if available)

### What to Expect

- **Acknowledgment**: Within 48 hours of submission
- **Status Updates**: We will keep you informed as we investigate and address the issue
- **Resolution**: We aim to release a fix within 90 days, depending on severity and complexity
- **Disclosure**: We follow coordinated disclosure. The reporter will be credited if desired (unless anonymity is requested)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.4.2   | :white_check_mark: |

## Architecture & Threat Model

DeskSpawn is a **desktop-first application**: a Tauri v2 (Rust) shell with a
local sidecar (Node/Bun) that runs entirely on the user's machine. There is
**no remote backend**. A browser demo exists for evaluation only. This
section describes what we protect and how.

### Local Attack Surface

The desktop app starts a **local sidecar HTTP server** on the loopback
interface (`127.0.0.1:<port>`, default ≈3009, fallback 3009→3010→… when
taken). It provides:

- An OpenAI-compatible **`/v1` proxy** that forwards to the
  **user-configured** upstream endpoint only. Arbitrary upstream forwarding
  (the `x-upstream` header) was removed as an SSRF risk. Requests without a
  token are rejected (`401 Unauthorized`), and no `Access-Control-Allow-Origin`
  is granted to foreign origins.
- `/api/models` (model list) and the local **preview dev server** for
  generated apps.

Because the server listens on loopback, **any local process** that can reach
`127.0.0.1` sits inside the same trust boundary as the app itself.

### Generated Code Execution

AI-generated application code is executed **on the user's host**: the local
preview of a generated app runs on a **Vite dev server**, and tooling scripts
run via **Bun**. Script execution is restricted to an **allowlist** (dev
scripts are template-fixed values only — arbitrary user-supplied commands are
not run), and the **first preview shows a confirmation dialog** before the
generated app is started on the host.

This containerization is **not an OS-level sandbox**: malicious code inside a
generated app is *not* isolated by the operating system. The iframe `sandbox`
attribute (desktop) and WebContainer (web demo) limit the generated app's
access to host storage and origins, but code running via the local Vite/Bun
processes executes with the privileges of the user. Therefore, treat
AI-generated code as untrusted: review it before use, and never grant it
additional host access.

### Data at Rest

| Data | Desktop (main product) | Web demo (evaluation only) |
|------|------------------------|----------------------------|
| AI API keys | **OS keychain** (Windows Credential Manager) via Rust IPC. Fallback when the keychain is unavailable: `credentials.json` under the user profile (`~/deskspawn/config/credentials.json`, file mode 600). The path is verified to stay inside `HOME`/`USERPROFILE`; writes outside are refused. | IndexedDB. Same-origin isolation, but browser extensions run outside that sandbox. |
| Generated app source | Real files under `~/deskspawn/apps/<app-id>/` | IndexedDB / OPFS |
| Chat history | SQLite `chat.db` per app (Rust-managed; ADR-013 v2 schema: `client_id` UNIQUE + `payload` JSON) | IndexedDB |
| Settings & AI provider config | JSON files under `~/deskspawn/config/` (keys in OS keychain, see above) | LocalStorage / IndexedDB |

### Data in Transit

| Destination | Path | Protection |
|-------------|------|------------|
| AI Provider API (user-configured) | HTTPS **through the local sidecar `/v1` proxy** | TLS. The app never sends keys to external servers directly; the sidecar attaches the stored key only for the configured upstream. |
| Generated app preview (desktop) | loopback `127.0.0.1` | Local Vite dev server; not reachable from other hosts. |
| Any other outbound traffic | — | None. No telemetry, no analytics, no backend. |

### Attack Vectors & Mitigations

| Threat | Mitigation |
|--------|-----------|
| **XSS via dependency vulnerability** | CSP restricts script execution to `'self'` + `'wasm-unsafe-eval'`. `connect-src` limits data-exfiltration targets. |
| **Malicious AI-generated code** | Generated code runs **on the user's host** (local Vite dev server / Bun tooling). Script execution is restricted to an **allowlist** (dev scripts are template-fixed values only), and the **first preview requires a confirmation dialog**. The code itself is **not isolated by an OS-level sandbox** — treat it as untrusted and review before use. On desktop the preview uses an iframe `sandbox` attribute; on web it runs in WebContainer — both prevent access to the host origin's storage. |
| **API key exfiltration via supply chain** | No backend to exfiltrate to. The sidecar proxies only the user-configured upstream; arbitrary `x-upstream` forwarding is rejected (SSRF guard). |
| **Sidecar abused by other local processes** | Listens on loopback only, requires a token (401 without it), grants no CORS to foreign origins. |
| **Plaintext key fallback (`credentials.json`)** | Used only when the OS keychain is unavailable; file mode 600; confined to the user profile (writes outside are refused). |
| **WebView2 CDP port** | The remote-debugging port (`--remote-debugging-port=9222`) is **never enabled by default** — it is a dev/E2E-only flag (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`). When enabled, WebView2 binds loopback (`::1`) and any local CDP client can control the app. Never enable it in production. |
| **Cross-origin data leakage (web demo)** | `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless` isolate the browsing context. |
| **Clickjacking** | `frame-ancestors 'none'` in CSP prevents embedding. |
| **Malicious browser extensions (web demo)** | The same-origin sandbox does not cover extensions; the web demo is evaluation-only. Use the desktop app (OS keychain) for real work. |

### Recommended Practices for Users

- Use the **desktop app** for real work; the browser demo is evaluation-only
- Use a dedicated API key with usage limits for DeskSpawn (most AI providers support this)
  - [OpenAI](https://platform.openai.com/settings/organization/limits)
  - [Anthropic](https://console.anthropic.com/settings/limits)
  - [Google AI](https://aistudio.google.com/)
- Keep your OS and browser updated
- Review generated app code before sharing or deploying it
- Export and back up important projects periodically

## Dependencies

DeskSpawn uses automated dependency management via Dependabot. Security audits (`pnpm audit`) run in CI for every pull request.

## Security Best Practices for DeskSpawn

- **API Keys**: On desktop, keys are stored in the **OS keychain** (Windows
  Credential Manager); `credentials.json` is a plaintext fallback confined to
  your user profile. Keys are never sent to any server other than the AI
  provider you configure — and on desktop they travel via the local sidecar
  proxy, not directly from the app. Do not share sessions or profiles on
  untrusted machines.
- **Generated Applications**: Review AI-generated code before distribution.
  Treat it as you would code from a junior developer.
- **CSP**: The web demo deployment includes a Content Security Policy. If you
  self-host it, ensure the `_headers` file or equivalent is deployed.
- **CDP**: Never run the desktop app with `--remote-debugging-port` enabled
  outside development (see the WebView2 CDP row above).
