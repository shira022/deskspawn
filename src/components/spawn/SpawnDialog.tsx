import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Package,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
} from "lucide-react";
import type { SpawnConfig } from "@/types";

interface SpawnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SpawnDialog({ open, onOpenChange }: SpawnDialogProps) {
  const [appName, setAppName] = useState("MyApp");
  const [version, setVersion] = useState("0.1.0");
  const [windowTitle, setWindowTitle] = useState("MyApp");
  const [step, setStep] = useState<"input" | "building" | "done" | "error">("input");
  const [buildOutput, setBuildOutput] = useState("");

  const handleBuild = async () => {
    setStep("building");
    setBuildOutput("");

    // Simulate build process
    const lines = [
      "> deskspawn@0.1.0 tauri",
      "> tauri build",
      "",
      "Pre-flight checks...",
      "  ✅ TypeScript compilation OK",
      "  ✅ cargo check OK",
      "  ✅ sqlx migrations OK",
      "",
      "Building application...",
      "  Compiling deskspawn v0.1.0",
      "  Compiling src-tauri v0.1.0",
      "  Finished release [optimized] in 45.2s",
      "",
      "Bundling...",
      "  NSIS installer: target/release/bundle/msi/MyApp_0.1.0_x64_en-US.msi",
      "  Setup.exe: target/release/bundle/nsis/MyApp_0.1.0_x64-setup.exe",
      "",
      "✅ Build completed successfully!",
    ];

    for (const line of lines) {
      await new Promise((r) => setTimeout(r, 300));
      setBuildOutput((prev) => prev + line + "\n");
    }

    setStep("done");
  };

  const outputPath = "workspace/src-tauri/target/release/bundle/";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Spawn .exe
          </DialogTitle>
          <DialogDescription>
            プロジェクトを .exe にビルドして、配布可能なインストーラーを生成します。
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {step === "input" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>アプリ名</Label>
              <Input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="MyApp"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>バージョン</Label>
                <Input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="0.1.0"
                />
              </div>
              <div className="space-y-2">
                <Label>ウィンドウタイトル</Label>
                <Input
                  value={windowTitle}
                  onChange={(e) => setWindowTitle(e.target.value)}
                  placeholder={appName}
                />
              </div>
            </div>
          </div>
        )}

        {step === "building" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>ビルド中...</span>
            </div>
            <div className="rounded-lg border bg-black p-3 font-mono text-xs text-green-400 h-48 overflow-auto">
              <pre className="whitespace-pre-wrap">{buildOutput}</pre>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">ビルド完了！</span>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <p className="text-sm font-medium">出力先</p>
              <p className="text-xs font-mono text-muted-foreground break-all">
                {outputPath}
              </p>
              <div className="flex gap-2">
                <Badge variant="secondary">
                  <Package className="h-3 w-3 mr-1" />
                  Setup.exe
                </Badge>
                <Badge variant="secondary">
                  <Package className="h-3 w-3 mr-1" />
                  .msi
                </Badge>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                // Open folder (Tauri-specific in real app)
                alert(`Output folder: ${outputPath}`);
              }}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              フォルダを開く
            </Button>
          </div>
        )}

        {step === "error" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="font-medium">ビルドに失敗しました</span>
            </div>
            <div className="rounded-lg border bg-destructive/5 p-3 font-mono text-xs text-destructive max-h-40 overflow-auto">
              <pre className="whitespace-pre-wrap">{buildOutput}</pre>
            </div>
            <p className="text-xs text-muted-foreground">
              AI による自動修正を試みます。チャットにエラーが表示されます。
            </p>
          </div>
        )}

        <DialogFooter>
          {step === "input" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                キャンセル
              </Button>
              <Button onClick={handleBuild}>
                ビルド開始
              </Button>
            </>
          )}
          {(step === "done" || step === "error") && (
            <Button onClick={() => onOpenChange(false)} className="w-full">
              閉じる
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
