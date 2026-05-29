import { useAppStore } from "@/store/useAppStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileText,
  FileCog,
  Database,
  ChevronRight,
  ChevronDown,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import type { FileNode } from "@/types";
import { SIDECAR_BASE } from "@/lib/constants";

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

// ── Build a file tree from a flat list of file entries ────────────────────────

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
        node = {
          name: part,
          path: fullPath,
          isDirectory: !isLast,
          children: !isLast ? [] : undefined,
        };
        current.push(node);
      }

      if (!isLast && node.children) {
        current = node.children;
      }
    }
  }

  return sortTree(root);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .sort((a, b) => {
      // Directories first
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((node) => {
      if (node.children) {
        return { ...node, children: sortTree(node.children) };
      }
      return node;
    });
}

// ── Icons ────────────────────────────────────────────────────────────────────

function getFileIcon(name: string, isDirectory: boolean) {
  if (isDirectory) return <Folder className="h-4 w-4 text-muted-foreground" />;
  if (name.endsWith(".tsx") || name.endsWith(".ts")) return <FileCode className="h-4 w-4 text-blue-400" />;
  if (name.endsWith(".css")) return <FileCode className="h-4 w-4 text-purple-400" />;
  if (name.endsWith(".rs")) return <FileCog className="h-4 w-4 text-orange-400" />;
  if (name.endsWith(".sql")) return <Database className="h-4 w-4 text-green-400" />;
  if (name.endsWith(".json") || name.endsWith(".toml") || name.endsWith(".lock"))
    return <FileText className="h-4 w-4 text-yellow-400" />;
  if (name.endsWith(".html")) return <FileCode className="h-4 w-4 text-orange-400" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

// ── Tree Item (recursive) ────────────────────────────────────────────────────

function TreeItem({
  node,
  depth,
  selectedFile,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.isDirectory && node.children && node.children.length > 0;
  const isSelected = selectedFile === node.path;

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded px-2 py-1 cursor-pointer hover:bg-muted/50 transition-colors text-sm ${
          isSelected ? "bg-muted" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
          if (!node.isDirectory) onSelect(node.path);
        }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {expanded && hasChildren ? (
          <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          getFileIcon(node.name, node.isDirectory)
        )}
        <span className="truncate text-xs">{node.name}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── File Preview ─────────────────────────────────────────────────────────────

function FilePreview({ filePath }: { filePath: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = `${SIDECAR_BASE}/projects/file?path=${encodeURIComponent(filePath)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setContent(data.content);
    } catch (e: any) {
      setError(e.message || "Failed to load file");
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  const lines = content?.split("\n") ?? [];

  return (
    <div className="h-40 border-t">
      {/* File name header */}
      <div className="flex h-6 items-center gap-1 border-b px-3 text-xs text-muted-foreground">
        <FileCode className="h-3 w-3" />
        <span className="truncate">{filePath}</span>
      </div>

      {/* Content area */}
      <div className="h-[calc(100%-24px)] overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            読み込み中...
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
                <span className="w-8 shrink-0 text-right text-muted-foreground/50 select-none pr-2 border-r border-border/50">
                  {i + 1}
                </span>
                <span className="pl-2 whitespace-pre">{line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── FileTreePanel ────────────────────────────────────────────────────────────

export function FileTreePanel() {
  const { selectedFile, setSelectedFile, setFileTree, workspaceReady } = useAppStore();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTree = useCallback(async () => {
    try {
      const res = await fetch(`${SIDECAR_BASE}/projects/files`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const files: { path: string }[] = data.files ?? [];
      const paths = files.map((f) => f.path);
      const fileTree = buildTreeFromPaths(paths);

      // Update store with typed FileNode[] for external access
      const toFileNode = (nodes: TreeNode[]): FileNode[] =>
        nodes.map((n) => ({
          name: n.name,
          path: n.path,
          isDirectory: n.isDirectory,
          children: n.children ? toFileNode(n.children) : undefined,
        }));
      setFileTree(toFileNode(fileTree));

      setTree(fileTree);
      setError("");
    } catch (e: any) {
      setError(e.message || "Failed to load file tree");
    } finally {
      setLoading(false);
    }
  }, [setFileTree]);

  // Initial fetch
  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Re-fetch when workspace becomes ready
  useEffect(() => {
    if (workspaceReady) {
      fetchTree();
    }
  }, [workspaceReady, fetchTree]);

  // Auto-refresh every 3s while workspace is ready
  useEffect(() => {
    if (workspaceReady) {
      pollRef.current = setInterval(fetchTree, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [workspaceReady, fetchTree]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">ファイル</span>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            fetchTree();
          }}
          className="p-1 rounded hover:bg-muted transition-colors"
          title="再読み込み"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* File Tree */}
      <ScrollArea className="flex-1" viewportClassName="py-2">
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            読み込み中...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 text-xs text-red-500">
            <AlertCircle className="h-3 w-3 mr-1" />
            {error}
          </div>
        ) : tree.length === 0 ? (
          <div className="px-3 py-8 text-xs text-muted-foreground text-center">
            <p className="mb-1">ファイルがありません</p>
            <p className="text-[10px]">AIにアプリ生成を指示してください</p>
          </div>
        ) : (
          tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedFile={selectedFile}
              onSelect={setSelectedFile}
            />
          ))
        )}
      </ScrollArea>

      <Separator />

      {/* File Preview */}
      {selectedFile ? (
        <FilePreview filePath={selectedFile} />
      ) : (
        <div className="h-10 border-t flex items-center justify-center text-[10px] text-muted-foreground">
          ファイルを選択すると内容が表示されます
        </div>
      )}
    </div>
  );
}
