/**
 * DeskSpawn Desktop — Root Application Component
 *
 * Full desktop UI with chat panel, preview, and settings.
 * Uses ServiceRegistry for platform-agnostic service access.
 */

import React, { useState, useEffect, useCallback } from "react";
import { ServiceRegistry, type StreamChunk } from "@deskspawn/ai-core";
import { registerDesktopServices } from "./lib/services";
import { AiConfigDialog } from "./components/AiConfigDialog";
import { ChatPanel } from "./components/ChatPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { StatusBar } from "./components/StatusBar";
import { Button } from "@deskspawn/ui";
import { Settings, Play, Square } from "lucide-react";
import "./index.css";

// Register Desktop services at module level
registerDesktopServices();

type ViewMode = "chat" | "preview";

export function App(): React.ReactElement {
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [sidecarOnline, setSidecarOnline] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<{
    provider: string;
    model: string;
    apiKey?: string;
    customEndpoint?: string;
  }>({ provider: "openai", model: "" });

  // ── Boot: check services ──────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const ai = ServiceRegistry.ai;
      const available = await ai.isAvailable();
      setSidecarOnline(available);

      // Load saved config
      const storage = ServiceRegistry.storage;
      const settings = await storage.loadSettings();
      if (settings?.provider) {
        setConfig((c) => ({
          ...c,
          provider: settings.provider ?? "openai",
          model: settings.model ?? "",
          customEndpoint: settings.customEndpoint ?? "",
        }));
      }
      const apiKey = await storage.loadApiKey(settings?.provider ?? "openai");
      if (apiKey) {
        setConfig((c) => ({ ...c, apiKey }));
      }
    })();
  }, []);

  // ── Config update handler ─────────────────────────────────────────

  const handleConfigChange = useCallback(
    async (newConfig: typeof config) => {
      setConfig(newConfig);
      const storage = ServiceRegistry.storage;
      await storage.saveSettings({
        provider: newConfig.provider,
        model: newConfig.model,
        customEndpoint: newConfig.customEndpoint,
      });
      if (newConfig.apiKey) {
        await storage.saveApiKey(newConfig.provider, newConfig.apiKey);
      }
    },
    [],
  );

  // ── Preview handlers ──────────────────────────────────────────────

  const handleStartPreview = useCallback(async (projectId: string, files: Record<string, string>) => {
    try {
      const result = await ServiceRegistry.preview.startPreview(projectId, files);
      setPreviewUrl(result.url);
      setViewMode("preview");
    } catch (e) {
      console.error("Preview failed:", e);
    }
  }, []);

  const handleStopPreview = useCallback(async () => {
    await ServiceRegistry.preview.stopPreview();
    setPreviewUrl(null);
    setViewMode("chat");
  }, []);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-12 items-center justify-between border-b px-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">DeskSpawn Desktop</span>
          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">v0.2.0</span>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === "preview" && previewUrl && (
            <Button size="sm" variant="outline" onClick={handleStopPreview}>
              <Square className="mr-1 h-3.5 w-3.5" />
              Stop Preview
            </Button>
          )}
          {viewMode === "chat" && (
            <Button size="sm" variant="outline" onClick={() => setViewMode("preview")}>
              <Play className="mr-1 h-3.5 w-3.5" />
              Preview
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowSettings(true)}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden">
        {viewMode === "chat" && (
          <div className="flex flex-1 flex-col">
            <ChatPanel
              config={config}
              onStartPreview={handleStartPreview}
            />
          </div>
        )}
        {viewMode === "preview" && (
          <div className="flex flex-1 flex-col">
            <PreviewPanel url={previewUrl} />
          </div>
        )}
      </main>

      {/* Status Bar */}
      <StatusBar sidecarOnline={sidecarOnline} />

      {/* Settings Dialog */}
      {showSettings && (
        <AiConfigDialog
          config={config}
          onSave={handleConfigChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
