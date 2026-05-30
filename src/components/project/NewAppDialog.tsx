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
import { Separator } from "@/components/ui/separator";
import { Loader2, Sparkles } from "lucide-react";
import { SIDECAR_BASE } from "@/lib/constants";

interface NewAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewAppDialog({ open, onOpenChange }: NewAppDialogProps) {
  const [appName, setAppName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const {
    setCurrentProjectId,
    setProjects,
    clearMessages,
    setWorkspaceReady,
    setAgentStatus,
    setAgentStepCount,
    setFileTree,
    setSelectedFile,
    setErrors,
    setProjectSwitching,
    setAppLoading,
  } = useAppStore();

  const handleCreate = async () => {
    const name = appName.trim();
    if (!name) {
      setError("アプリ名を入力してください");
      return;
    }

    setCreating(true);
    setError("");
    setProjectSwitching(true);

    try {
      const res = await fetch(`${SIDECAR_BASE}/projects/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const { project, projects } = data;

      // Update store
      setProjects(projects);
      setCurrentProjectId(project.id);

      // Reset all session state for fresh start
      clearMessages();
      setWorkspaceReady(false);
      setAgentStatus("idle");
      setAgentStepCount(0);
      setFileTree([]);
      setSelectedFile(null);
      setErrors([]);

      // Keep projectSwitching true + set appLoading to show preparation overlay
      setAppLoading(true);

      onOpenChange(false);
      setAppName("");
    } catch (e: any) {
      const msg = String(e.message || e);
      // Network errors (sidecar not running) → friendly message
      if (/Load failed|fetch|NetworkError|Failed to fetch|connect.*refused|ECONNREFUSED/i.test(msg)) {
        setError("サイドカーサーバーに接続できません。\n`npm run sidecar` を実行してから再試行してください。");
      } else {
        setError(msg);
      }
      setProjectSwitching(false);
      setAppLoading(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            新しいアプリを作成
          </DialogTitle>
          <DialogDescription>
            DeskSpawn で新しいアプリをゼロから作成します。
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>アプリ名</Label>
            <Input
              value={appName}
              onChange={(e) => {
                setAppName(e.target.value);
                setError("");
              }}
              placeholder="例: タスク管理アプリ"
              autoFocus
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground space-y-1">
              <span>• React + Vite + Tailwind CSS のテンプレートを使用</span><br />
              <span>• データは IndexedDB（ブラウザ内蔵DB）に自動保存</span><br />
              <span>• 変更は自動でバックアップされます</span><br />
              <span>• 他のユーザーとアプリを共有するにはエクスポート/インポート</span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            キャンセル
          </Button>
          <Button onClick={handleCreate} disabled={creating || !appName.trim()}>
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                作成中...
              </>
            ) : (
              "作成"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
