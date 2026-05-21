import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  MonitorCheck,
  MonitorX,
  Monitor,
  PackageOpen,
  Wrench,
  Cpu,
} from "lucide-react";

const envCheckIcons: Record<string, React.ReactNode> = {
  "Node.js": <PackageOpen className="h-4 w-4" />,
  "Rust (MSVC Toolchain)": <Wrench className="h-4 w-4" />,
  "Visual Studio Build Tools": <Monitor className="h-4 w-4" />,
  "WebView2 Runtime": <Cpu className="h-4 w-4" />,
};

export function EnvCheckScreen() {
  const { envChecks, setEnvCheckStatus, setPhase, allEnvChecksPassed } = useAppStore();

  useEffect(() => {
    // Simulate environment checks since we can't actually run tauri commands in dev mode
    const runChecks = async () => {
      // Check Node.js
      await delay(600);
      setEnvCheckStatus(0, "ok");

      // Check Rust
      await delay(400);
      try {
        // Check if rustc exists
        const rustInstalled = await checkCommand("rustc --version");
        setEnvCheckStatus(1, rustInstalled ? "ok" : "fail");
      } catch {
        setEnvCheckStatus(1, "fail");
      }

      // VS Build Tools - mock on macOS
      await delay(400);
      const isWindows = navigator.platform.toLowerCase().includes("win");
      setEnvCheckStatus(2, isWindows ? "fail" : "ok");

      // WebView2 - mock
      await delay(300);
      setEnvCheckStatus(3, isWindows ? "fail" : "ok");
    };

    runChecks();
  }, []);

  const allPassed = allEnvChecksPassed();
  const hasChecked = envChecks.every((c) => c.status !== "pending");

  const openUrl = (url?: string) => {
    if (url) window.open(url, "_blank");
  };

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-full max-w-lg space-y-6 rounded-xl border bg-card p-8 shadow-lg">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <MonitorCheck className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">環境チェック</h1>
          <p className="text-sm text-muted-foreground">
            Tauri で .exe をビルドするために必要な依存関係を確認します
          </p>
        </div>

        <Separator />

        <ScrollArea className="h-[320px]">
          <div className="space-y-3 px-1">
            {envChecks.map((item, i) => (
              <div
                key={item.name}
                className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-background text-muted-foreground">
                  {envCheckIcons[item.name] ?? <MonitorX className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{item.name}</p>
                    {item.status === "ok" && (
                      <Badge variant="success">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        OK
                      </Badge>
                    )}
                    {item.status === "fail" && (
                      <Badge variant="destructive">
                        <XCircle className="mr-1 h-3 w-3" />
                        未インストール
                      </Badge>
                    )}
                    {item.status === "pending" && (
                      <Badge variant="outline">
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        確認中
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  {item.status === "fail" && item.downloadUrl && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => openUrl(item.downloadUrl)}
                    >
                      インストール <ExternalLink className="ml-1 h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <Separator />

        <div className="space-y-3">
          {hasChecked && !allPassed && (
            <p className="text-sm text-warning-foreground text-center">
              すべての依存関係をインストールしてから再度お試しください
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setPhase("ai-config")}
              className="flex-1"
            >
              戻る
            </Button>
            <Button
              onClick={() => setPhase("main")}
              className="flex-1"
              disabled={!hasChecked}
            >
              DeskSpawn を始める
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            ※ 一部の依存関係が不足していても、チャット機能は利用できます。ビルド時に必要になります。
          </p>
        </div>
      </div>
    </div>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkCommand(cmd: string): Promise<boolean> {
  // In browser context we can't run shell commands directly
  // Mock: return true for Node.js which we know is installed
  if (cmd.includes("node")) return true;
  return false;
}
