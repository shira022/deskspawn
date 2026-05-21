import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  FolderKanban,
  Plus,
  Clock,
  Check,
  Loader2,
} from "lucide-react";
import type { ProjectMeta } from "@/types";

const SIDECAR_BASE = "http://localhost:3001";

interface ProjectSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewApp: () => void;
}

export function ProjectSwitcher({ open, onOpenChange, onNewApp }: ProjectSwitcherProps) {
  const ref = useRef<HTMLDivElement>(null);

  const {
    currentProjectId,
    setCurrentProjectId,
    projects,
    setProjects,
    clearMessages,
    setWorkspaceReady,
    setAgentStatus,
    setAgentStepCount,
    setFileTree,
    setSelectedFile,
    setErrors,
    projectSwitching,
    setProjectSwitching,
  } = useAppStore();

  // Fetch projects on open
  useEffect(() => {
    if (open) {
      fetch(`${SIDECAR_BASE}/projects/list`)
        .then((res) => res.json())
        .then((data) => setProjects(data.projects || []))
        .catch(console.error);
    }
  }, [open, setProjects]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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
      const res = await fetch(`${SIDECAR_BASE}/projects/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || `HTTP ${res.status}`);
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
    } catch (e: any) {
      console.error("Project switch failed:", e);
    } finally {
      setProjectSwitching(false);
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
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              アプリ履歴
            </span>
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
              新規作成
            </Button>
          </div>

          <Separator className="my-1.5" />

          {projects.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center text-muted-foreground">
              <FolderKanban className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs">アプリ履歴はまだありません</p>
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
                最初のアプリを作成
              </Button>
            </div>
          ) : (
            <ScrollArea className="max-h-64" viewportClassName="space-y-0.5">
              {projects
                .slice()
                .reverse()
                .map((project) => {
                  const isActive = project.id === currentProjectId;
                  return (
                    <button
                      key={project.id}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors hover:bg-muted ${
                        isActive ? "bg-muted" : ""
                      }`}
                      onClick={() => handleSelect(project)}
                      disabled={projectSwitching}
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
                    </button>
                  );
                })}
            </ScrollArea>
          )}
        </div>
      </div>
    </>
  );
}
