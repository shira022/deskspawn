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
import { sidecarBase } from "@/lib/constants";
import { parseSidecarError } from "@/lib/utils";

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
    setErrors,
    setProjectSwitching,
    setAppLoading,
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
      const res = await fetch(`${sidecarBase()}/projects/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(parseSidecarError(data) || `HTTP ${res.status}`);
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
        setError(t('project.sidecarError'));
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
