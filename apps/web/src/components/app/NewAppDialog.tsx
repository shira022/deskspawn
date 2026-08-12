import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { listApps, saveApp } from "@/lib/storage";
import { setAppId } from "@/engine/tool-executors";
import { writeAppFiles, writeAppFile } from "@/lib/storage-opfs";
import { getTemplateFiles } from "@/lib/template";
import { isDesktopEnv } from "@/lib/platform";

interface NewAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewAppDialog({ open, onOpenChange }: NewAppDialogProps) {
  const [appName, setAppName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  const {
    setCurrentAppId,
    setApps,
    clearMessages,
    setWorkspaceReady,
    setAgentStatus,
    setAgentStepCount,
    setFileTree,
    setSelectedFile,
    setAppSwitching,
    setAppLoading,
    triggerReload,
    settings,
  } = useAppStore();

  const handleCreate = async () => {
    const name = appName.trim();
    if (!name) {
      setError(t('app.appNameRequired'));
      return;
    }

    setCreating(true);
    setError("");
    setAppSwitching(true);

    try {
      const appId = crypto.randomUUID();
      const now = new Date().toISOString();

      const app = {
        id: appId,
        name,
        createdAt: now,
        updatedAt: now,
      };

      // Save to IndexedDB (web) or Rust registry (desktop).
      // Desktop: the backend assigns its own id (`app-...`) which is the REAL
      // directory id — use it for everything below so files land in the
      // actual on-disk app dir (ADR-008).
      const realAppId = await saveApp(app);

      // Set current app in engine
      setAppId(realAppId);

      // Refresh app list
      const updatedApps = await listApps();
      setApps(updatedApps);
      setCurrentAppId(realAppId);

      // Reset session state
      clearMessages();
      setWorkspaceReady(false);
      setAgentStatus("idle");
      setAgentStepCount(0);
      setFileTree([]);
      setSelectedFile(null);

      // Copy template files into the new app (real dir on desktop)
      // ADR-010: desktop はフルスタックテンプレート（Hono + bun:sqlite）を
      // 使う。isDesktop を渡さないと Web版（IndexedDB）が常に選ばれる。
      await writeAppFiles(
        realAppId,
        getTemplateFiles(settings.language, isDesktopEnv()),
      );

      // Write the actual app ID so the generated app uses the correct DB name
      await writeAppFile(realAppId, "src/lib/app-id.ts",
        `// ============================================================
// App ID — injected by DeskSpawn at app creation time.
// DO NOT MODIFY: Uniquely identifies this app's IndexedDB.
// ============================================================

export const APP_ID = "${realAppId}";
`,
      );

      // ワークスペースの準備完了 — ローディングオーバーレイを即時解除
      // プレビューのビルドはバックグラウンドで非同期に実行される
      setWorkspaceReady(true);
      setAppLoading(false);
      triggerReload();
      onOpenChange(false);
      setAppSwitching(false);
      setAppName("");
    } catch (e: any) {
      setError(e.message || t('app.createError') || 'Failed to create app');
      setAppSwitching(false);
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
            {t('app.createNewTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('app.createNewDesc')}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('app.appName')}</Label>
            <Input
              value={appName}
              onChange={(e) => {
                setAppName(e.target.value);
                setError("");
              }}
              placeholder={t('app.appNamePlaceholder')}
              autoFocus
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground space-y-1">
              <span>{t('app.templateReact')}</span><br />
              {/* Desktop: フルスタックテンプレート (Hono + SQLite, ADR-010) / Web: IndexedDB */}
              <span>{isDesktopEnv() ? t('app.templateSQLite') : t('app.templateIndexedDB')}</span><br />
              <span>{t('app.templateAutoBackup')}</span><br />
              <span>{t('app.templateShare')}</span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={creating || !appName.trim()}>
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('app.creating')}
              </>
            ) : (
              t('app.create')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
