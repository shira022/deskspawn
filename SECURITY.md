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
| 0.2.x   | :white_check_mark: |

## Architecture & Threat Model

DeskSpawn is a **client-side-only web application** with no backend server. This section describes what we protect and how.

### Data at Rest

| Data | Storage | Protection |
|------|---------|------------|
| AI API keys (OpenAI, Anthropic, etc.) | IndexedDB | Sandboxed by browser origin. Accessible only to JavaScript running on the same origin. |
| Project source code (generated apps) | IndexedDB / OPFS | Same-origin isolation. |
| Settings & preferences | LocalStorage | Standard browser sandbox. |

### Data in Transit

| Destination | Protocol | Protection |
|-------------|----------|-----------|
| AI Provider API (user-configured) | HTTPS (TLS 1.3) | Standard internet encryption. DeskSpawn does not proxy or inspect API traffic. |
| No other outbound data | — | DeskSpawn has no telemetry, no analytics, no backend. |

### Attack Vectors & Mitigations

| Threat | Mitigation |
|--------|-----------|
| **XSS via dependency vulnerability** | CSP restricts script execution to `'self'` + `'wasm-unsafe-eval'`. `connect-src` limits data exfiltration targets. |
| **Malicious AI-generated code** | Runs inside WebContainer — a sandboxed environment that cannot access IndexedDB, LocalStorage, or the host origin's cookies. Also isolated via iframe `sandbox` attribute. |
| **API key exfiltration via supply chain** | No backend to exfiltrate to. CSP restricts outbound connections to known AI provider endpoints. |
| **Cross-origin data leakage** | `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless` isolate the browsing context. |
| **Clickjacking** | `frame-ancestors 'none'` in CSP prevents embedding. |

### Recommended Practices for Users

- Use a dedicated API key with usage limits for DeskSpawn (most AI providers support this)
- Keep your browser updated
- Review generated app code before sharing or deploying it
- Export and backup important projects

## Dependencies

DeskSpawn uses automated dependency management via Dependabot. Security audits (`npm audit`) run in CI for every pull request.

## Security Best Practices for DeskSpawn

- **API Keys**: API keys are stored in your browser's IndexedDB. They are never sent to any server other than the AI provider you configure. Do not share browser sessions on untrusted devices.
- **Generated Applications**: Review AI-generated code before distribution. Treat it as you would any code from a junior developer.
- **CSP**: The production deployment includes a Content Security Policy. If you self-host, ensure the `_headers` file or equivalent is deployed.
