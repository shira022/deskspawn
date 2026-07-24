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
import { listProjects, saveProject } from "@/lib/storage";
import { setProjectId } from "@/engine/tool-executors";
import { writeProjectFiles, writeProjectFile } from "@/lib/storage-opfs";
import { getTemplateFiles } from "@/lib/template";

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
    setCurrentProjectId,
    setProjects,
    clearMessages,
    setWorkspaceReady,
    setAgentStatus,
    setAgentStepCount,
    setFileTree,
    setSelectedFile,
    setProjectSwitching,
    setAppLoading,
    triggerReload,
    settings,
  } = useAppStore();

  const handleCreate = async () => {
    const name = appName.trim();
    if (!name) {
      setError(t('project.appNameRequired'));
      return;
    }

    setCreating(true);
    setError("");
    setProjectSwitching(true);

    try {
      const projectId = crypto.randomUUID();
      const now = new Date().toISOString();

      const project = {
        id: projectId,
        name,
        createdAt: now,
        updatedAt: now,
      };

      // Save to IndexedDB
      await saveProject(project);

      // Set current project in engine
      setProjectId(projectId);

      // Refresh project list
      const updatedProjects = await listProjects();
      setProjects(updatedProjects);
      setCurrentProjectId(projectId);

      // Reset session state
      clearMessages();
      setWorkspaceReady(false);
      setAgentStatus("idle");
      setAgentStepCount(0);
      setFileTree([]);
      setSelectedFile(null);

      // Copy template files into the new project
      await writeProjectFiles(projectId, getTemplateFiles(settings.language));

      // Write the actual project ID so the generated app uses the correct DB name
      await writeProjectFile(projectId, "src/lib/project-id.ts",
        `// ============================================================
// Project ID — injected by DeskSpawn at project creation time.
// DO NOT MODIFY: Uniquely identifies this project's IndexedDB.
// ============================================================

export const PROJECT_ID = "${projectId}";
`,
      );

      // ワークスペースの準備完了 — ローディングオーバーレイを即時解除
      // プレビューのビルドはバックグラウンドで非同期に実行される
      setWorkspaceReady(true);
      setAppLoading(false);
      triggerReload();
      onOpenChange(false);
      setProjectSwitching(false);
      setAppName("");
    } catch (e: any) {
      setError(e.message || t('project.createError') || 'Failed to create project');
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
            {t('project.createNewTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('project.createNewDesc')}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('project.appName')}</Label>
            <Input
              value={appName}
              onChange={(e) => {
                setAppName(e.target.value);
                setError("");
              }}
              placeholder={t('project.appNamePlaceholder')}
              autoFocus
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground space-y-1">
              <span>{t('project.templateReact')}</span><br />
              <span>{t('project.templateIndexedDB')}</span><br />
              <span>{t('project.templateAutoBackup')}</span><br />
              <span>{t('project.templateShare')}</span>
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
                {t('project.creating')}
              </>
            ) : (
              t('project.create')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
