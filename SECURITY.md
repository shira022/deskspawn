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

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Best Practices for DeskSpawn

DeskSpawn is an AI-powered application development platform. Please be aware:

- **API Keys**: API keys are stored via the OS keychain. Never share your keychain or export API keys in plaintext.
- **Generated Applications**: Applications built with DeskSpawn carry their own security considerations. Review generated code before distribution.
- **Dependencies**: DeskSpawn installs and runs third-party packages during app generation. Keep your environment updated.
