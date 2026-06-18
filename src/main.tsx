/**
 * DeskSpawn Entry Point
 *
 * Boot sequence:
 *   1. Language selection (first visit / cleared storage)
 *   2. Browser compatibility check (auto)
 *   3. If OK → proceed to Landing Page or App
 *   4. If fail → show error screen with retry
 */

import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { LandingPage } from "./routes/landing";
import { LanguageSelectScreen } from "./components/onboarding/LanguageSelectScreen";
import { checkCompatibility, getCompatErrorMessage, type CompatResult } from "./lib/compatibility";
import { SETTINGS_KEY } from "./lib/constants";
import i18n from "./lib/i18n";
import "./index.css";
import { Loader2, AlertTriangle, RefreshCw, Globe } from "lucide-react";

// ── Route helpers ─────────────────────────────────────────────────────────────

function getRoute(): "/" | "/app" {
  const stored = localStorage.getItem("deskspawn_route");
  if (stored === "/app") return "/app";
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("page") === "app") return "/app";
  }
  return "/";
}

function saveLanguageToStorage(code: string) {
  localStorage.setItem("deskspawn_language", code);
  // Also merge into app settings so the Zustand store picks it up
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const settings = raw ? JSON.parse(raw) : {};
    settings.language = code;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // non-critical
  }
}

// ── Boot Phases ───────────────────────────────────────────────────────────────

type BootPhase = "language-select" | "compat-check" | "compat-error" | "ready";

// ── Boot Sequence ─────────────────────────────────────────────────────────────

function BootSequence({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<BootPhase>("language-select");
  const [compatResult, setCompatResult] = useState<CompatResult | null>(null);

  // On mount: skip language selection if already chosen
  useEffect(() => {
    const savedLang = localStorage.getItem("deskspawn_language");
    if (savedLang) {
      setPhase("compat-check");
    }
  }, []);

  // Run compatibility check
  useEffect(() => {
    if (phase !== "compat-check") return;
    checkCompatibility().then((r) => {
      setCompatResult(r);
      setPhase(r.ok ? "ready" : "compat-error");
    });
  }, [phase]);

  const handleLanguageSelect = (code: string) => {
    i18n.changeLanguage(code);
    saveLanguageToStorage(code);
    setPhase("compat-check");
  };

  // ── Language selection ─────────────────────────────────────────────────────
  if (phase === "language-select") {
    return <LanguageSelectScreen onSelect={handleLanguageSelect} />;
  }

  // ── Compatibility check (loading) ─────────────────────────────────────────
  if (phase === "compat-check") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Globe className="h-6 w-6 animate-pulse text-primary" />
          <Loader2 className="h-5 w-5 animate-spin" />
          <p className="text-sm">Checking browser compatibility...</p>
        </div>
      </div>
    );
  }

  // ── Compatibility error ───────────────────────────────────────────────────
  if (phase === "compat-error" && compatResult) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-4">
        <div className="max-w-lg space-y-4 rounded-xl border border-destructive/30 bg-card p-8 text-center shadow-lg">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Browser not compatible</h2>
          <pre className="whitespace-pre-wrap text-left text-sm text-muted-foreground bg-muted rounded-md p-4">
            {getCompatErrorMessage(compatResult)}
          </pre>
          <button
            onClick={() => setPhase("compat-check")}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Ready ─────────────────────────────────────────────────────────────────
  return <>{children}</>;
}

// ── Root ───────────────────────────────────────────────────────────────────────

function Root() {
  const [route] = useState(getRoute);

  return (
    <BootSequence>
      <React.StrictMode>
        {route === "/" ? <LandingPage /> : <App />}
      </React.StrictMode>
    </BootSequence>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);
