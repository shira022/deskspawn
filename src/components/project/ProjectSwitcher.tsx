import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  FolderKanban,
  Plus,
  Clock,
  Check,
  Trash2,
  Download,
  Upload,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ProjectMeta } from "@/types";
import { sidecarBase } from "@/lib/constants";
import { parseSidecarError } from "@/lib/utils";

interface ProjectSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewApp: () => void;
}

export function ProjectSwitcher({ open, onOpenChange, onNewApp }: ProjectSwitcherProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [importing, setImporting] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const { t } = useTranslation();

  const {
    currentProjectId,
    setCurrentProjectId,
    projects,
    setProjects,
    removeProject,
    clearMessages,
    setWorkspaceReady,
    setAgentStatus,
    setAgentStepCount,
    setFileTree,
    setSelectedFile,
    setErrors,
    setCheckpoints,
    setCurrentCheckpointIndex,
    setVisibleMessageCount,
    projectSwitching,
    setProjectSwitching,
    addToast,
  } = useAppStore();

  // Fetch projects on open
  useEffect(() => {
    if (open) {
      fetch(`${sidecarBase()}/projects/list`)
        .then((res) => res.json())
        .then((data) => setProjects(data.projects || []))
        .catch(console.error);
    }
  }, [open, setProjects]);

  // Reset delete target when popover closes
  useEffect(() => {
    if (!open) {
      setDeleteTarget(null);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target) &&
          !dialogRef.current?.contains(target)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  const handleSelect = async (project: ProjectMeta) => {
    if (project.id === currentProjectId) {
      onOpenChange(false);
      return;
    }

    setProjectSwitching(true);
    onOpenChange(false);

    try {
      const res = await fetch(`${sidecarBase()}/projects/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(parseSidecarError(data) || `HTTP ${res.status}`);
      }

      const data = await res.json();

      // Update store
      setProjects(data.projects);
      setCurrentProjectId(project.id);

      // Reset session state for fresh start in the switched project
      clearMessages();
      setWorkspaceReady(false);
      setAgentStatus("idle");
      setAgentStepCount(0);
      setFileTree([]);
      setSelectedFile(null);
      setErrors([]);
      setCheckpoints([]);
      setCurrentCheckpointIndex(-1);
      setVisibleMessageCount(-1);

      // Keep projectSwitching true — PreviewPanel will clear it when workspaceReady
    } catch (e: any) {
      console.error("Project switch failed:", e);
      setProjectSwitching(false);
    }
  };

  const handleDelete = async (project: ProjectMeta) => {
    setDeleteError("");
    try {
      const res = await fetch(`${sidecarBase()}/projects/${project.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(parseSidecarError(data) || `HTTP ${res.status}`);
      }
      const data = await res.json();

      // If the deleted project was the current one, clear currentProjectId
      if (project.id === currentProjectId) {
        setCurrentProjectId(null);
      }

      removeProject(project.id);
      setProjects(data.projects);
      setDeleteTarget(null);
    } catch (e: any) {
      setDeleteError(e.message || t('project.deleteError'));
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("ja-JP", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const handleExport = async (project: ProjectMeta) => {
    setExportingId(project.id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${sidecarBase()}/projects/${project.id}/export`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(parseSidecarError(data) || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name}.deskspawn`;
      a.click();
      URL.revokeObjectURL(url);

      addToast({ variant: "success", message: t('project.exportSuccess', { name: project.name }) });
    } catch (e: any) {
      if (e.name === "AbortError") {
        addToast({ variant: "error", message: t('project.exportTimeout') });
      } else {
        addToast({ variant: "error", message: `${t('project.exportError')}: ${e.message || e}` });
      }
    } finally {
      clearTimeout(timeout);
      setExportingId(null);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);

    try {
      // Read file as base64
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const fileBase64 = btoa(binary);

      const res = await fetch(`${sidecarBase()}/projects/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64 }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(parseSidecarError(data) || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setProjects(data.projects || []);
      const projectName = data.project?.name || file.name.replace(/\.deskspawn$/i, '');
      addToast({ variant: "success", message: t('project.importSuccess', { name: projectName }) });
      onOpenChange(false);
    } catch (e: any) {
      addToast({ variant: "error", message: `${t('project.importError')}: ${e.message || ''}` });
    } finally {
      setImporting(false);
      // Reset input so the same file can be imported again
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
      <div
        ref={ref}
        className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border bg-card shadow-xl"
      >
        <div className="p-2">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 shrink-0">
              <Clock className="h-3 w-3" />
              {t('project.history')}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleImportClick}
                disabled={importing}
                title={t('project.import')}
              >
                {importing ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3 mr-1" />
                )}
                {importing ? t('project.importing') : t('project.import')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  onOpenChange(false);
                  onNewApp();
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                {t('project.createNew')}
              </Button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".deskspawn"
            className="hidden"
            onChange={handleFileSelected}
          />

          <Separator className="my-1.5" />

          {projects.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center text-muted-foreground">
              <FolderKanban className="h-8 w-8 mb-2 opacity-30" />
               <p className="text-xs">{t('project.noHistory')}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-7 text-xs"
                onClick={() => {
                  onOpenChange(false);
                  onNewApp();
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                {t('project.createFirst')}
              </Button>
            </div>
          ) : (
            <ScrollArea className="max-h-64" viewportClassName="max-h-64 space-y-0.5">
              {projects
                .slice()
                .reverse()
                .map((project) => {
                  const isActive = project.id === currentProjectId;
                  return (
                    <div
                      key={project.id}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors hover:bg-muted cursor-pointer ${
                        isActive ? "bg-muted" : ""
                      } ${projectSwitching ? "pointer-events-none opacity-50" : ""}`}
                      onClick={() => !projectSwitching && handleSelect(project)}
                      onKeyDown={(e) => {
                        if (!projectSwitching && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          handleSelect(project);
                        }
                      }}
                      role="button"
                      tabIndex={projectSwitching ? -1 : 0}
                    >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium truncate text-sm">
                              {project.name}
                            </span>
                            {isActive && (
                              <Check className="h-3 w-3 text-primary shrink-0" />
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(project.updatedAt)}
                          </span>
                        </div>
                        <button
                          className="shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleExport(project);
                          }}
                          disabled={exportingId === project.id}
                          title={exportingId === project.id ? '' : t('project.export')}
                        >
                          {exportingId === project.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setDeleteTarget(project);
                          }}
                          title={t('project.delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                  );
                })}
            </ScrollArea>
          )}
        </div>
      </div>
      {deleteTarget && (
        <div ref={dialogRef}>
          <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(""); } }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('project.deleteTitle')}</DialogTitle>
                <DialogDescription>
                  {t('project.deleteConfirm', { name: deleteTarget?.name || '' })}
                </DialogDescription>
              </DialogHeader>
              {deleteError && (
                <div className="px-6">
                  <p className="text-sm text-destructive">{deleteError}</p>
                </div>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(null);
                    setDeleteError("");
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (deleteTarget) {
                      handleDelete(deleteTarget);
                    }
                  }}
                >
                  {t('project.deleteConfirmButton')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  );
}
