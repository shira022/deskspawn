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
import { listProjects, deleteProject as deleteStoredProject, saveProject } from "@/lib/storage";
import { deleteProjectDir as deleteOpfsDir } from "@/lib/storage-opfs";
import { setProjectId, deleteProjectCheckpoints } from "@/engine/tool-executors";
import { exportProjectAsZip, importProjectFromZip } from "@/lib/project-export";

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
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
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
    setCheckpoints,
    setCurrentCheckpointIndex,
    setVisibleMessageCount,
    projectSwitching,
    setProjectSwitching,
  } = useAppStore();

  // Fetch projects from IndexedDB on open
  useEffect(() => {
    if (open) {
      listProjects().then(setProjects).catch(console.error);
    }
  }, [open, setProjects]);

  // Reset delete target when popover closes
  useEffect(() => {
    if (!open) setDeleteTarget(null);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target) && !dialogRef.current?.contains(target)) {
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
      // Update timestamp
      const now = new Date().toISOString();
      const { saveProject } = await import("@/lib/storage");
      await saveProject({ ...project, updatedAt: now });

      // Set current project in engine
      setProjectId(project.id);
      setCurrentProjectId(project.id);

      // Reset session state
      clearMessages();
      setWorkspaceReady(false);
      setAgentStatus("idle");
      setAgentStepCount(0);
      setFileTree([]);
      setSelectedFile(null);
      setCheckpoints([]);
      setCurrentCheckpointIndex(-1);
      setVisibleMessageCount(-1);

      // Refresh project list
      const updatedProjects = await listProjects();
      setProjects(updatedProjects);
      setProjectSwitching(false);
    } catch (e: any) {
      console.error("Project switch failed:", e);
      setProjectSwitching(false);
    }
  };

  const handleDelete = async (project: ProjectMeta) => {
    if (project.id === currentProjectId) {
      setDeleteError(t('project.deleteDisabledActive'));
      return;
    }
    setDeleteError("");
    try {
      await deleteStoredProject(project.id);
      // Delete OPFS project files
      deleteOpfsDir(project.id).catch(() => {});
      // Delete checkpoints for this project
      await deleteProjectCheckpoints(project.id);

      if (project.id === currentProjectId) {
        setCurrentProjectId(null);
      }
      removeProject(project.id);
      setDeleteTarget(null);
    } catch (e: any) {
      setDeleteError(e.message || t('project.deleteError'));
    }
  };

  // ── Export ──────────────────────────────────────────────────────────────────

  const handleExport = async (project: ProjectMeta) => {
    setExportingId(project.id);
    try {
      await exportProjectAsZip(project.id, project.name);
      const { addToast } = useAppStore.getState();
      addToast({ message: t('project.exportSuccess', { name: project.name }), variant: "success" });
    } catch (e: any) {
      const { addToast } = useAppStore.getState();
      addToast({ message: e.message || t('project.exportError'), variant: "error" });
    } finally {
      setExportingId(null);
    }
  };

  // ── Import ──────────────────────────────────────────────────────────────────

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const projectId = crypto.randomUUID();
      const result = await importProjectFromZip(file, projectId);

      const now = new Date().toISOString();
      await saveProject({
        id: projectId,
        name: result.projectName,
        createdAt: now,
        updatedAt: now,
      });

      // Refresh project list
      const updatedProjects = await listProjects();
      const { setProjects, addToast } = useAppStore.getState();
      setProjects(updatedProjects);
      addToast({ message: t('project.importSuccess', { name: result.projectName }), variant: "success" });
    } catch (e: any) {
      const { addToast } = useAppStore.getState();
      addToast({ message: e.message || t('project.importError'), variant: "error" });
    } finally {
      setImporting(false);
      // Reset file input so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("ja-JP", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
    } catch { return ""; }
  };

  if (!open) return null;

  return (
    <>
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.deskspawn.zip"
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
      <div ref={ref} className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border bg-card shadow-xl">
        <div className="p-2">
          <div className="flex items-center gap-1 px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mr-auto shrink-0">
              <Clock className="h-3 w-3" />
              {t('project.history')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs shrink-0"
              onClick={handleImportClick}
              disabled={importing}
              title={t('project.import')}
            >
              {importing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              <span className="hidden sm:inline ml-1">{t('project.import')}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs shrink-0"
              onClick={() => { onOpenChange(false); onNewApp(); }}
            >
              <Plus className="h-3 w-3" />
              <span className="hidden sm:inline ml-1">{t('project.createNew')}</span>
            </Button>
          </div>

          <Separator className="my-1.5" />

          {projects.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center text-muted-foreground">
              <FolderKanban className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs">{t('project.noHistory')}</p>
              <Button variant="outline" size="sm" className="mt-3 h-7 text-xs"
                onClick={() => { onOpenChange(false); onNewApp(); }}>
                <Plus className="h-3 w-3 mr-1" />
                {t('project.createFirst')}
              </Button>
            </div>
          ) : (
            <ScrollArea className="max-h-64" viewportClassName="max-h-64 space-y-0.5">
              {projects.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((project) => {
                const isActive = project.id === currentProjectId;
                return (
                  <div key={project.id}
                    className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors hover:bg-muted cursor-pointer ${isActive ? "bg-muted" : ""} ${projectSwitching ? "pointer-events-none opacity-50" : ""}`}
                    onClick={() => !projectSwitching && handleSelect(project)}
                    role="button" tabIndex={projectSwitching ? -1 : 0}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate text-sm">{project.name}</span>
                        {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{formatDate(project.updatedAt)}</span>
                    </div>
                    <button
                      className="shrink-0 p-1 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleExport(project); }}
                      disabled={exportingId === project.id}
                      title={t('project.export')}
                    >
                      {exportingId === project.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button className={`shrink-0 p-1 rounded transition-colors ${isActive ? 'text-muted-foreground/30 cursor-not-allowed' : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'}`}
                      onClick={(e) => { if (isActive) return; e.stopPropagation(); e.preventDefault(); setDeleteTarget(project); }}
                      title={isActive ? t('project.deleteDisabledActive') : t('project.delete')}
                      disabled={isActive}>
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
                <DialogDescription>{t('project.deleteConfirm', { name: deleteTarget?.name || '' })}</DialogDescription>
              </DialogHeader>
              {deleteError && <div className="px-6"><p className="text-sm text-destructive">{deleteError}</p></div>}
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => { setDeleteTarget(null); setDeleteError(""); }}>
                  {t('common.cancel')}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => { if (deleteTarget) handleDelete(deleteTarget); }}>
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
