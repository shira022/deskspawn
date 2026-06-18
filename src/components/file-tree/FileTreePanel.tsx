import { useAppStore } from "@/store/useAppStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileText,
  ChevronRight,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { FileNode } from "@/types";
import { listProjectFiles, readProjectFile } from "@/lib/storage-opfs";

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

function buildTreeFromPaths(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      let node = current.find((n) => n.name === part);
      if (!node) {
        node = { name: part, path: fullPath, isDirectory: !isLast, children: !isLast ? [] : undefined };
        current.push(node);
      } else if (!isLast && !node.isDirectory) {
        // Upgrade: existing entry was created as a file, but it's actually a directory
        node.isDirectory = true;
        node.children = [];
      }
      if (!isLast) {
        if (!node.children) node.children = [];
        current = node.children;
      }
    }
  }
  return sortTree(root);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((node) => ({ ...node, children: node.children ? sortTree(node.children) : undefined }));
}

function getFileIcon(name: string, isDirectory: boolean, isExpanded?: boolean) {
  if (isDirectory) {
    return isExpanded
      ? <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
      : <Folder className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
  if (name.endsWith(".tsx") || name.endsWith(".ts")) return <FileCode className="h-4 w-4 text-blue-400 shrink-0" />;
  if (name.endsWith(".css")) return <FileCode className="h-4 w-4 text-purple-400 shrink-0" />;
  if (name.endsWith(".json") || name.endsWith(".toml")) return <FileText className="h-4 w-4 text-yellow-400 shrink-0" />;
  if (name.endsWith(".html")) return <FileCode className="h-4 w-4 text-orange-400 shrink-0" />;
  return <File className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function TreeItem({ node, depth, selectedFile, onSelect }: {
  node: TreeNode; depth: number; selectedFile: string | null; onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.isDirectory && node.children && node.children.length > 0;
  const isSelected = selectedFile === node.path;

  const handleClick = () => {
    if (node.isDirectory) {
      if (hasChildren) setExpanded(!expanded);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center h-7 cursor-pointer select-none hover:bg-muted/50 transition-colors ${isSelected ? "bg-muted text-foreground" : "text-foreground/80"}`}
        style={{ paddingLeft: `${depth * 14 + 6}px`, paddingRight: "8px" }}
        onClick={handleClick}
      >
        {node.isDirectory ? (
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {getFileIcon(node.name, node.isDirectory, expanded && hasChildren)}
        <span className="truncate text-[13px] leading-none ml-0.5">{node.name}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} selectedFile={selectedFile} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilePreview({ filePath }: { filePath: string }) {
  const { t } = useTranslation();
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchContent = useCallback(async () => {
    if (!currentProjectId) return;
    setLoading(true);
    setError("");
    try {
      const data = await readProjectFile(currentProjectId, filePath);
      if (data === null) throw new Error("File not found");
      setContent(data);
    } catch (e: any) {
      setError(e.message || t('fileTree.errorLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [filePath, currentProjectId]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  const lines = content?.split("\n") ?? [];

  return (
    <div className="h-40 border-t">
      <div className="flex h-6 items-center gap-1 border-b px-3 text-xs text-muted-foreground">
        <FileCode className="h-3 w-3" />
        <span className="truncate">{filePath}</span>
      </div>
      <div className="h-[calc(100%-24px)] overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            {t('common.loading')}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-xs text-red-500">
            <AlertCircle className="h-3 w-3 mr-1" />
            {error}
          </div>
        ) : (
          <div className="font-mono text-[10px] leading-5">
            {lines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-8 shrink-0 text-right text-muted-foreground/50 select-none pr-2 border-r border-border/50">{i + 1}</span>
                <span className="pl-2 whitespace-pre">{line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function FileTreePanel() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const { selectedFile, setSelectedFile, setFileTree, workspaceReady } = useAppStore();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { t } = useTranslation();

  const fetchTree = useCallback(async () => {
    if (!currentProjectId) return;
    try {
      const files = await listProjectFiles(currentProjectId);
      // Filter out directory entries: buildTreeFromPaths creates directory
      // nodes from file-path segments, so explicit directory entries cause
      // duplicate/incorrect tree nodes.
      const paths = files.filter((f) => !f.isDirectory).map((f) => f.path);
      const fileTree = buildTreeFromPaths(paths);

      const toFileNode = (nodes: TreeNode[]): FileNode[] =>
        nodes.map((n) => ({
          name: n.name, path: n.path, isDirectory: n.isDirectory,
          children: n.children ? toFileNode(n.children) : undefined,
        }));
      setFileTree(toFileNode(fileTree));

      setTree(fileTree);
      setError("");
    } catch (e: any) {
      setError(e.message || t('fileTree.errorLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [currentProjectId, setFileTree]);

  useEffect(() => { fetchTree(); }, [fetchTree]);
  useEffect(() => { if (workspaceReady) fetchTree(); }, [workspaceReady, fetchTree]);

  useEffect(() => {
    if (workspaceReady) {
      pollRef.current = setInterval(fetchTree, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [workspaceReady, fetchTree]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('fileTree.title')}</span>
        </div>
        <button onClick={() => { setLoading(true); fetchTree(); }}
          className="p-1 rounded hover:bg-muted transition-colors" title={t('fileTree.refresh')}>
          <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <ScrollArea className="flex-1" viewportClassName="py-2">
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />{t('common.loading')}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 text-xs text-red-500">
            <AlertCircle className="h-3 w-3 mr-1" />{error}
          </div>
        ) : tree.length === 0 ? (
          <div className="px-3 py-8 text-xs text-muted-foreground text-center">
            <p className="mb-1">{t('fileTree.noFiles')}</p>
            <p className="text-[10px]">{t('fileTree.askAiToGenerate')}</p>
          </div>
        ) : (
          tree.map((node) => (
            <TreeItem key={node.path} node={node} depth={0} selectedFile={selectedFile} onSelect={setSelectedFile} />
          ))
        )}
      </ScrollArea>

      <Separator />
      {selectedFile ? <FilePreview filePath={selectedFile} /> : (
        <div className="h-10 border-t flex items-center justify-center text-[10px] text-muted-foreground">
          {t('fileTree.selectFileToPreview')}
        </div>
      )}
    </div>
  );
}
