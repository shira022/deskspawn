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

const SIDECAR_BASE = "http://localhost:3001";

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
  } = useAppStore();

  const handleCreate = async () => {
    const name = appName.trim();
    if (!name) {
      setError("アプリ名を入力してください");
      return;
    }

    setCreating(true);
    setError("");

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

      onOpenChange(false);
      setAppName("");
    } catch (e: any) {
      setError(e.message || "アプリの作成に失敗しました");
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
            新しいアプリをまっさらな状態から作成します。
            過去のアプリは履歴からいつでも再開できます。
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
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground space-y-1">
              <span>• 新しいチャットセッションが開始されます</span><br />
              <span>• React + Vite + Tailwind CSS のテンプレートが使用されます</span><br />
              <span>• 作成後すぐにチャットでアプリの構築を開始できます</span>
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
