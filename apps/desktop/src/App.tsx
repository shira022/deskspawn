/**
 * DeskSpawn Desktop — Root Application Component
 *
 * Manages the desktop app lifecycle: language selection, compatibility check,
 * and the main application UI. Uses Tauri IPC for platform operations.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  checkEnvironment,
  getSidecarStatus,
  loadAiConfig,
  checkForUpdates,
} from "./lib/ipc";
import { Button } from "@deskspawn/ui";
import { Loader2, AlertTriangle, RefreshCw, Wifi, WifiOff } from "lucide-react";

type BootPhase = "loading" | "ready" | "error";

interface DesktopState {
  bootPhase: BootPhase;
  bootError: string | null;
  sidecarOnline: boolean;
  sidecarPort: number;
  env: Record<string, boolean> | null;
}

export function App(): React.ReactElement {
  const [state, setState] = useState<DesktopState>({
    bootPhase: "loading",
    bootError: null,
    sidecarOnline: false,
    sidecarPort: 3001,
    env: null,
  });

  // ── Boot Sequence ────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        // Check environment
        const env = await checkEnvironment();
        setState((s) => ({ ...s, env }));

        // Check sidecar status
        const status = await getSidecarStatus();
        const port = 3001; // default for now

        setState((s) => ({
          ...s,
          bootPhase: "ready",
          sidecarOnline: status === "running",
          sidecarPort: port,
        }));
      } catch (e) {
        setState((s) => ({
          ...s,
          bootPhase: "error",
          bootError: String(e),
        }));
      }
    })();
  }, []);

  const handleRetry = useCallback(() => {
    setState((s) => ({ ...s, bootPhase: "loading", bootError: null }));
    // Re-trigger boot via re-mount trick
    window.location.reload();
  }, []);

  // ── Loading State ────────────────────────────────────────────────────

  if (state.bootPhase === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Initializing DeskSpawn Desktop...</p>
        </div>
      </div>
    );
  }

  // ── Error State ──────────────────────────────────────────────────────

  if (state.bootPhase === "error") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <h2 className="text-lg font-semibold">Startup Error</h2>
          <p className="text-sm text-muted-foreground">{state.bootError}</p>
          <Button onClick={handleRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ── Main UI ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen flex-col bg-background">
      {/* Status Bar */}
      <header className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">DeskSpawn Desktop</span>
          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
            v0.2.0
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Sidecar Status */}
          <div className="flex items-center gap-1.5 text-xs">
            {state.sidecarOnline ? (
              <>
                <Wifi className="h-3 w-3 text-success" />
                <span className="text-success">Sidecar Online</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Sidecar Offline</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex flex-1 items-center justify-center">
        <div className="flex max-w-lg flex-col items-center gap-6 text-center">
          <div className="rounded-full bg-primary/10 p-4">
            <Wifi className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">DeskSpawn Desktop</h1>
          <p className="text-muted-foreground">
            AI-powered web app generation platform — Desktop Edition.
            <br />
            Built with Tauri v2 + React + Rust.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button
              onClick={async () => {
                const updates = await checkForUpdates();
                alert(updates);
              }}
            >
              Check for Updates
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const config = await loadAiConfig();
                alert(config ? `Configured: ${config.provider}/${config.model}` : "No config yet");
              }}
            >
              Show Config
            </Button>
          </div>

          {/* Environment Info */}
          {state.env && (
            <div className="mt-4 w-full rounded-lg border p-4 text-left text-xs">
              <h3 className="mb-2 font-semibold">Environment</h3>
              <dl className="grid grid-cols-2 gap-1">
                {Object.entries(state.env).map(([key, val]) => (
                  <>
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className={val ? "text-success" : "text-destructive"}>
                      {val ? "✓" : "✗"}
                    </dd>
                  </>
                ))}
              </dl>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="flex h-8 items-center justify-center border-t text-xs text-muted-foreground">
        DeskSpawn {state.sidecarOnline ? "• Sidecar connected" : "• Offline mode"}
      </footer>
    </div>
  );
}
