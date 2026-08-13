import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
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
} from "../ui/dialog";
import type { AppMeta } from "../../types";
import { listApps, deleteApp as deleteStoredApp, saveApp } from "../../lib/storage";
import { deleteAppDir as deleteOpfsDir } from "../../lib/storage-opfs";
import { setAppId, deleteAppCheckpoints } from "../../engine/tool-executors";
import { exportAppAsZip, importAppFromZip } from "../../lib/app-export";
import { isDesktopEnv } from "../../lib/platform";

interface AppSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewApp: () => void;
}

export function AppSwitcher({ open, onOpenChange, onNewApp }: AppSwitcherProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppMeta | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const { t } = useTranslation();

  const {
    currentAppId,
    setCurrentAppId,
    apps,
    setApps,
    removeApp,
    clearMessages,
    setWorkspaceReady,
    setAgentStatus,
    setAgentStepCount,
    setFileTree,
    setSelectedFile,
    setCheckpoints,
    setCurrentCheckpointIndex,
    setVisibleMessageCount,
    appSwitching,
    setAppSwitching,
  } = useAppStore();

  // Fetch apps from IndexedDB on open
  useEffect(() => {
    if (open) {
      listApps().then(setApps).catch(console.error);
    }
  }, [open, setApps]);

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

  const handleSelect = async (app: AppMeta) => {
    if (app.id === currentAppId) {
      onOpenChange(false);
      return;
    }

    setAppSwitching(true);
    onOpenChange(false);

    try {
      // Update timestamp
      const now = new Date().toISOString();
      const { saveApp } = await import("../../lib/storage");
      await saveApp({ ...app, updatedAt: now });

      // Set current app in engine
      setAppId(app.id);
      setCurrentAppId(app.id);

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

      // Refresh app list
      const updatedApps = await listApps();
      setApps(updatedApps);
      setAppSwitching(false);
    } catch (e: any) {
      console.error("App switch failed:", e);
      setAppSwitching(false);
    }
  };

  const handleDelete = async (app: AppMeta) => {
    if (app.id === currentAppId) {
      setDeleteError(t('app.deleteDisabledActive'));
      return;
    }
    setDeleteError("");
    try {
      await deleteStoredApp(app.id);
      // Delete OPFS app files
      deleteOpfsDir(app.id).catch(() => {});
      // Delete checkpoints for this app
      await deleteAppCheckpoints(app.id);

      if (app.id === currentAppId) {
        setCurrentAppId(null);
      }
      removeApp(app.id);
      setDeleteTarget(null);
    } catch (e: any) {
      setDeleteError(e.message || t('app.deleteError'));
    }
  };

  // ── Export ──────────────────────────────────────────────────────────────────

  const handleExport = async (app: AppMeta) => {
    setExportingId(app.id);
    try {
      if (isDesktopEnv()) {
        // M1-B: デスクトップは実ファイルを Rust 側で zip 化して保存ダイアログを出す
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("export_app_zip", { appId: app.id });
      } else {
        await exportAppAsZip(app.id, app.name);
      }
      const { addToast } = useAppStore.getState();
      addToast({ message: t('app.exportSuccess', { name: app.name }), variant: "success" });
    } catch (e: any) {
      const { addToast } = useAppStore.getState();
      addToast({ message: e.message || t('app.exportError'), variant: "error" });
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
      const { setApps, addToast } = useAppStore.getState();
      if (isDesktopEnv()) {
        // M1-B: デスクトップは Rust が zip 展開（zip slip 対策込み）して
        // 実ディレクトリ + レジストリへ登録する。ファイル選択ダイアログも Rust 側。
        const { invoke } = await import("@tauri-apps/api/core");
        const meta = await invoke<{ id: string; name: string }>("import_app_zip");
        const updatedApps = await listApps();
        setApps(updatedApps);
        addToast({ message: t('app.importSuccess', { name: meta.name }), variant: "success" });
      } else {
        const appId = crypto.randomUUID();
        const result = await importAppFromZip(file, appId);

        const now = new Date().toISOString();
        await saveApp({
          id: appId,
          name: result.appName,
          createdAt: now,
          updatedAt: now,
        });

        // Refresh app list
        const updatedApps = await listApps();
        setApps(updatedApps);
        addToast({ message: t('app.importSuccess', { name: result.appName }), variant: "success" });
      }
    } catch (e: any) {
      const { addToast } = useAppStore.getState();
      addToast({ message: e.message || t('app.importError'), variant: "error" });
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
              {t('app.history')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs shrink-0"
              onClick={handleImportClick}
              disabled={importing}
              title={t('app.import')}
            >
              {importing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              <span className="hidden sm:inline ml-1">{t('app.import')}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs shrink-0"
              onClick={() => { onOpenChange(false); onNewApp(); }}
            >
              <Plus className="h-3 w-3" />
              <span className="hidden sm:inline ml-1">{t('app.createNew')}</span>
            </Button>
          </div>

          <Separator className="my-1.5" />

          {apps.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center text-muted-foreground">
              <FolderKanban className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs">{t('app.noHistory')}</p>
              <Button variant="outline" size="sm" className="mt-3 h-7 text-xs"
                onClick={() => { onOpenChange(false); onNewApp(); }}>
                <Plus className="h-3 w-3 mr-1" />
                {t('app.createFirst')}
              </Button>
            </div>
          ) : (
            <ScrollArea className="max-h-64" viewportClassName="max-h-64 space-y-0.5">
              {apps.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((app) => {
                const isActive = app.id === currentAppId;
                return (
                  <div key={app.id}
                    className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors hover:bg-muted cursor-pointer ${isActive ? "bg-muted" : ""} ${appSwitching ? "pointer-events-none opacity-50" : ""}`}
                    onClick={() => !appSwitching && handleSelect(app)}
                    role="button" tabIndex={appSwitching ? -1 : 0}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate text-sm">{app.name}</span>
                        {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{formatDate(app.updatedAt)}</span>
                    </div>
                    <button
                      className="shrink-0 p-1 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleExport(app); }}
                      disabled={exportingId === app.id}
                      title={t('app.export')}
                    >
                      {exportingId === app.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button className={`shrink-0 p-1 rounded transition-colors ${isActive ? 'text-muted-foreground/30 cursor-not-allowed' : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'}`}
                      onClick={(e) => { if (isActive) return; e.stopPropagation(); e.preventDefault(); setDeleteTarget(app); }}
                      title={isActive ? t('app.deleteDisabledActive') : t('app.delete')}
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
                <DialogTitle>{t('app.deleteTitle')}</DialogTitle>
                <DialogDescription>{t('app.deleteConfirm', { name: deleteTarget?.name || '' })}</DialogDescription>
              </DialogHeader>
              {deleteError && <div className="px-6"><p className="text-sm text-destructive">{deleteError}</p></div>}
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => { setDeleteTarget(null); setDeleteError(""); }}>
                  {t('common.cancel')}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => { if (deleteTarget) handleDelete(deleteTarget); }}>
                  {t('app.deleteConfirmButton')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  );
}
