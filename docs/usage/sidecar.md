# Sidecar Architecture

DeskSpawn uses a **sidecar process** to handle AI operations outside the main
Tauri application window. This page explains what the sidecar does, how to
manage it, and how to troubleshoot common issues.

---

## What Is the Sidecar?

The sidecar is a separate binary that runs alongside the DeskSpawn desktop app.
Its responsibilities include:

- **AI provider communication** — sending prompts and receiving responses from
  OpenAI, Anthropic, or Ollama.
- **Project persistence** — backing up project data from IndexedDB to the local
  filesystem on a regular schedule.
- **File system operations** — exporting projects, managing directories, and
  handling file I/O that the Tauri webview cannot do directly.
- **Health monitoring** — reporting its status back to the main app so the UI
  can display connection state.

### Why a Sidecar?

| Reason | Detail |
|--------|--------|
| **Process isolation** | AI operations can be memory-intensive. A separate process prevents UI freezes. |
| **Security** | The sidecar runs with minimal permissions and can be sandboxed independently. |
| **Crash resilience** | If the sidecar crashes, the UI stays responsive and can restart it automatically. |
| **Platform flexibility** | The sidecar is a compiled binary per platform, making it easy to distribute. |

---

## How to Start and Stop the Sidecar

The sidecar is managed automatically by DeskSpawn:

- **Start** — the sidecar launches when you open DeskSpawn and stops when you
  close the app.
- **Restart** — if the sidecar becomes unresponsive, go to **Settings → Sidecar**
  and click **Restart Sidecar**.
- **Manual start** (power users):
  ```bash
  # The sidecar binary is located inside the app bundle
  # Run it from a terminal to see detailed logs
  ./deskspawn-sidecar
  ```

> Normally you should not need to interact with the sidecar directly. The
> dashboard shows a green indicator when it is running.

---

## Troubleshooting

### Sidecar fails to start

1. **Check the logs** — look in the app's data directory:
   - **Windows:** `%APPDATA%/deskspawn/logs/`
   - **macOS:** `~/Library/Logs/deskspawn/`
   - **Linux:** `~/.local/share/deskspawn/logs/`
2. **Port conflict** — the sidecar uses port 9876 by default. Make sure
   nothing else is using it.
3. **Firewall** — some firewalls block the sidecar's local connections.
   Add an exception for the DeskSpawn sidecar binary.

### Sidecar crashes after launch

- Try restarting from **Settings → Sidecar → Restart**.
- If the issue persists, check the logs for error messages and open an
  issue on [GitHub](https://github.com/shira022/deskspawn/issues).

### AI requests are slow or fail

- The sidecar relies on the AI provider's API. Check your internet connection
  and provider status.
- If using Ollama, verify Ollama is running and the correct model is loaded.

---

## Technical Overview (for Contributors)

- **Language:** Rust (compiled as a standalone binary).
- **Communication:** JSON-RPC over a local WebSocket connection on port 9876.
- **Lifecycle:** Managed by Tauri's sidecar API — the binary is bundled with
  the app and extracted at runtime.
- **Logging:** Structured logging via `tracing` to both stdout and rotating
  log files.

### Building the Sidecar

```bash
# From the repository root
cargo build -p deskspawn-sidecar

# The binary will be placed at
# target/debug/deskspawn-sidecar  (or target/release/)
```

---

## See Also

- [AI Features](./ai-features.md) — configuring AI providers
- [Managing Projects](./projects.md) — project lifecycle and storage
