/**
 * DeskSpawn Desktop — Tauri IPC Bridge
 *
 * Wraps Tauri invoke() calls for the frontend. In non-Tauri environments
 * (e.g., browser dev), falls back to mock implementations.
 */

let tauriApi: typeof import("@tauri-apps/api/core") | null = null;

async function ensureTauri(): Promise<boolean> {
  if (tauriApi) return true;
  try {
    tauriApi = await import("@tauri-apps/api/core");
    return true;
  } catch {
    return false;
  }
}

// ── AI Config ──────────────────────────────────────────────────────────────

export interface AiConfig {
  provider: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  customEndpoint?: string;
  region?: string;
}

export async function saveAiConfig(config: AiConfig): Promise<boolean> {
  if (!(await ensureTauri())) return false;
  try {
    await tauriApi!.invoke("save_ai_config", { config });
    return true;
  } catch (e) {
    console.error("save_ai_config failed:", e);
    return false;
  }
}

export async function loadAiConfig(): Promise<AiConfig | null> {
  if (!(await ensureTauri())) return null;
  try {
    const result = await tauriApi!.invoke<AiConfig>("load_ai_config");
    return result;
  } catch {
    return null;
  }
}

// ── Sidecar Management ────────────────────────────────────────────────────

export async function getSidecarStatus(): Promise<string> {
  if (!(await ensureTauri())) return "offline";
  try {
    return await tauriApi!.invoke<string>("sidecar_status");
  } catch {
    return "offline";
  }
}

export async function getSidecarPort(): Promise<number> {
  if (!(await ensureTauri())) return 3001;
  try {
    return await tauriApi!.invoke<number>("sidecar_port");
  } catch {
    return 3001;
  }
}

export async function restartSidecar(): Promise<boolean> {
  if (!(await ensureTauri())) return false;
  try {
    await tauriApi!.invoke("restart_sidecar");
    return true;
  } catch {
    return false;
  }
}

export async function killSidecar(): Promise<boolean> {
  if (!(await ensureTauri())) return false;
  try {
    await tauriApi!.invoke("kill_sidecar");
    return true;
  } catch {
    return false;
  }
}

// ── Harness (File Operations) ─────────────────────────────────────────────

export async function readFile(path: string): Promise<string | null> {
  if (!(await ensureTauri())) return null;
  try {
    return await tauriApi!.invoke<string>("read_file", { path });
  } catch {
    return null;
  }
}

export async function listFiles(): Promise<string[]> {
  if (!(await ensureTauri())) return [];
  try {
    return await tauriApi!.invoke<string[]>("list_files");
  } catch {
    return [];
  }
}

export async function getWorkspacePath(): Promise<string | null> {
  if (!(await ensureTauri())) return null;
  try {
    return await tauriApi!.invoke<string>("get_workspace_path");
  } catch {
    return null;
  }
}

// ── AI Pipeline (via Sidecar) ──────────────────────────────────────────────

/**
 * Send a chat message through Rust → Sidecar IPC.
 * Falls back to direct fetch when not running in Tauri.
 */
export async function sendChatMessage(
  messages: Array<{ role: string; content: string }>,
  config: AiConfig,
): Promise<string> {
  if (!(await ensureTauri())) {
    // Fallback: direct API call (for dev/testing)
    return fallbackAiCall(messages, config);
  }

  // TODO: Implement full Sidecar IPC chat flow
  // For now, route through the sidecar HTTP API
  const port = await getSidecarPort();
  try {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, config }),
    });
    if (!res.ok) throw new Error(`Sidecar returned ${res.status}`);
    const data = await res.json();
    return data.text ?? "";
  } catch (e) {
    console.error("Sidecar chat failed, falling back to direct:", e);
    return fallbackAiCall(messages, config);
  }
}

/**
 * Direct API fallback (same as web app's browser fetch).
 */
async function fallbackAiCall(
  messages: Array<{ role: string; content: string }>,
  config: AiConfig,
): Promise<string> {
  const { provider, model, apiKey, customEndpoint } = config;
  if (!apiKey) throw new Error("No API key configured");

  let url: string;
  let body: Record<string, unknown>;

  switch (provider) {
    case "openai": {
      url = `${customEndpoint || "https://api.openai.com/v1"}/chat/completions`;
      body = { model: model || "gpt-4o", messages, stream: false };
      break;
    }
    case "anthropic": {
      url = "https://api.anthropic.com/v1/messages";
      body = { model: model || "claude-sonnet-4-20250514", messages, max_tokens: 4096 };
      break;
    }
    default: {
      url = `${customEndpoint || `https://api.${provider}.com/v1`}/chat/completions`;
      body = { model, messages, stream: false };
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI API returned ${res.status}`);

  if (provider === "anthropic") {
    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Environment Check ─────────────────────────────────────────────────────

export async function checkEnvironment(): Promise<Record<string, boolean>> {
  if (!(await ensureTauri())) {
    return { tauri: false, sidecar: false, node: false };
  }
  try {
    return await tauriApi!.invoke<Record<string, boolean>>("check_environment");
  } catch {
    return { tauri: true, sidecar: false, node: false };
  }
}

// ── Updater ───────────────────────────────────────────────────────────────

export async function checkForUpdates(): Promise<string> {
  if (!(await ensureTauri())) return "Updates not available in browser mode.";
  try {
    return await tauriApi!.invoke<string>("check_for_updates");
  } catch (e) {
    return `Update check failed: ${e}`;
  }
}
