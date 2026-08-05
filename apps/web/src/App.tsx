import { Component, type ReactNode, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { MainLayout } from "@/components/layout/MainLayout";
import { ToastContainer } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Loader2 } from "lucide-react";

// ── ErrorBoundary ────────────────────────────────────────────────────────────

class ErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void; errorTitle: string; unknownErrorLabel: string; reloadLabel: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("App ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background">
          <div className="max-w-md space-y-4 rounded-xl border bg-card p-8 text-center shadow-lg">
            <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold">{this.props.errorTitle}</h2>
            <p className="text-sm text-muted-foreground break-all">
              {this.state.error?.message || this.props.unknownErrorLabel}
            </p>
            <Button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onReset();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {this.props.reloadLabel}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main App ──────────────────────────────────────────────────────────────────

export function App() {
  const initialized = useAppStore((s) => s.initialized);
  const initialize = useAppStore((s) => s.initialize);
  const settings = useAppStore((s) => s.settings);
  const setResolvedTheme = useAppStore((s) => s.setResolvedTheme);

  // ── Initialize app ────────────────────────────────────────────────
  useEffect(() => {
    initialize();
  }, [initialize]);

  // ── Theme management ──────────────────────────────────────────────
  const applyTheme = useCallback((theme: string) => {
    const isDark = theme === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    setResolvedTheme(isDark ? "dark" : "light");
  }, [setResolvedTheme]);

  useEffect(() => {
    if (settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mq.matches ? "dark" : "light");

      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? "dark" : "light");
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      applyTheme(settings.theme);
    }
  }, [settings.theme, applyTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-font-size", `${settings.uiFontSize}px`);
    document.documentElement.style.setProperty("--code-font-size", `${settings.codeFontSize}px`);
  }, [settings.uiFontSize, settings.codeFontSize]);

  const { t } = useTranslation();

  // ── Loading screen (init) ────────────────────────────────────────
  if (!initialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  // ── Main app ──────────────────────────────────────────────────────
  return (
    <ErrorBoundary
      onReset={() => window.location.reload()}
      errorTitle={t('common.errorOccurred')}
      unknownErrorLabel={t('common.unknownError')}
      reloadLabel={t('common.reload')}
    >
      <div className="h-screen w-screen overflow-hidden bg-background" style={{ fontSize: "var(--ui-font-size, 14px)" }}>
        <MainLayout />
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
}
