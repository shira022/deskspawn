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
} from "lucide-react";
import { useState } from "react";

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

const demoFileTree: TreeNode[] = [
  {
    name: "src",
    path: "src",
    isDirectory: true,
    children: [
      { name: "App.tsx", path: "src/App.tsx", isDirectory: false },
      { name: "main.tsx", path: "src/main.tsx", isDirectory: false },
      { name: "index.css", path: "src/index.css", isDirectory: false },
      {
        name: "components",
        path: "src/components",
        isDirectory: true,
        children: [
          { name: "TaskList.tsx", path: "src/components/TaskList.tsx", isDirectory: false },
        ],
      },
      {
        name: "hooks",
        path: "src/hooks",
        isDirectory: true,
        children: [
          { name: "useTasks.ts", path: "src/hooks/useTasks.ts", isDirectory: false },
        ],
      },
      {
        name: "custom",
        path: "src/custom",
        isDirectory: true,
        children: [],
      },
    ],
  },
  {
    name: "src-tauri",
    path: "src-tauri",
    isDirectory: true,
    children: [
      { name: "Cargo.toml", path: "src-tauri/Cargo.toml", isDirectory: false },
      { name: "tauri.conf.json", path: "src-tauri/tauri.conf.json", isDirectory: false },
      {
        name: "src",
        path: "src-tauri/src",
        isDirectory: true,
        children: [
          { name: "lib.rs", path: "src-tauri/src/lib.rs", isDirectory: false },
          { name: "db.rs", path: "src-tauri/src/db.rs", isDirectory: false },
          {
            name: "generated",
            path: "src-tauri/src/generated",
            isDirectory: true,
            children: [
              { name: "tasks.rs", path: "src-tauri/src/generated/tasks.rs", isDirectory: false },
            ],
          },
          {
            name: "custom",
            path: "src-tauri/src/custom",
            isDirectory: true,
            children: [],
          },
        ],
      },
    ],
  },
  {
    name: "migrations",
    path: "migrations",
    isDirectory: true,
    children: [
      { name: "0001_create_tasks.sql", path: "migrations/0001_create_tasks.sql", isDirectory: false },
    ],
  },
  { name: "package.json", path: "package.json", isDirectory: false },
  { name: "vite.config.ts", path: "vite.config.ts", isDirectory: false },
  { name: "tsconfig.json", path: "tsconfig.json", isDirectory: false },
  { name: "tailwind.config.ts", path: "tailwind.config.ts", isDirectory: false },
  { name: "index.html", path: "index.html", isDirectory: false },
];

function getFileIcon(name: string, isDirectory: boolean) {
  if (isDirectory) return <Folder className="h-4 w-4 text-muted-foreground" />;
  if (name.endsWith(".tsx") || name.endsWith(".ts")) return <FileCode className="h-4 w-4 text-blue-400" />;
  if (name.endsWith(".css")) return <FileCode className="h-4 w-4 text-purple-400" />;
  if (name.endsWith(".rs")) return <FileCog className="h-4 w-4 text-orange-400" />;
  if (name.endsWith(".sql")) return <Database className="h-4 w-4 text-green-400" />;
  if (name.endsWith(".json") || name.endsWith(".toml")) return <FileText className="h-4 w-4 text-yellow-400" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

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
        {expanded && hasChildren ? <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" /> : getFileIcon(node.name, node.isDirectory)}
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

export function FileTreePanel() {
  const { selectedFile, setSelectedFile } = useAppStore();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center gap-2 border-b px-3">
        <Folder className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">ファイル</span>
      </div>

      {/* File Tree */}
      <ScrollArea className="flex-1" viewportClassName="py-2">
        {demoFileTree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            selectedFile={selectedFile}
            onSelect={setSelectedFile}
          />
        ))}
      </ScrollArea>

      <Separator />

      {/* File Preview */}
      {selectedFile && (
        <div className="h-40 border-t">
          <div className="flex h-6 items-center border-b px-3 text-xs text-muted-foreground">
            <FileCode className="h-3 w-3 mr-1" />
            {selectedFile}
          </div>
          <div className="p-2 text-xs font-mono text-muted-foreground overflow-auto h-[calc(100%-24px)]">
            <p className="italic">読み取り専用（編集はAIに指示してください）</p>
          </div>
        </div>
      )}
    </div>
  );
}
