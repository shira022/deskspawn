import { Component, type ReactNode, useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { AiConfigScreen } from "@/components/onboarding/AiConfigScreen";
import { EnvCheckScreen } from "@/components/onboarding/EnvCheckScreen";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Loader2 } from "lucide-react";

class ErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; onReset: () => void }) {
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
            <h2 className="text-lg font-semibold">エラーが発生しました</h2>
            <p className="text-sm text-muted-foreground break-all">
              {this.state.error?.message || "不明なエラー"}
            </p>
            <Button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onReset();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              再読み込み
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const phase = useAppStore((s) => s.phase);
  const initialized = useAppStore((s) => s.initialized);
  const initialize = useAppStore((s) => s.initialize);
  const setPhase = useAppStore((s) => s.setPhase);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleReset = () => {
    setPhase("ai-config");
  };

  if (!initialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary onReset={handleReset}>
      <div className="h-screen w-screen overflow-hidden bg-background">
        {phase === "ai-config" && <AiConfigScreen />}
        {phase === "env-check" && <EnvCheckScreen />}
        {phase === "main" && <MainLayout />}
      </div>
    </ErrorBoundary>
  );
}
