import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { FileTreePanel } from "@/components/file-tree/FileTreePanel";
import { SpawnDialog } from "@/components/spawn/SpawnDialog";
import { StatusBar } from "@/components/layout/StatusBar";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  LayoutPanelLeft,
  PanelsLeftRight,
  LayoutPanelTop,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

const layoutIcons: Record<string, React.ReactNode> = {
  "2-pane": <PanelsLeftRight className="h-4 w-4" />,
  "3-pane": <LayoutPanelLeft className="h-4 w-4" />,
};

const layoutLabels: Record<string, string> = {
  "2-pane": "2ペイン（チャット＋プレビュー）",
  "3-pane": "3ペイン（ファイル＋チャット＋プレビュー）",
};

export function MainLayout() {
  const { layoutMode, setLayoutMode } = useAppStore();
  const [showSpawn, setShowSpawn] = useState(false);

  const toggleLayout = () => {
    setLayoutMode(layoutMode === "2-pane" ? "3-pane" : "2-pane");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-10 items-center justify-between border-b bg-muted/30 px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">DeskSpawn</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setShowSpawn(true)}
          >
            <LayoutPanelTop className="mr-1 h-4 w-4" />
            <span className="text-xs">Spawn .exe</span>
          </Button>
          <Tooltip content={layoutLabels[layoutMode]}>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleLayout}>
              {layoutIcons[layoutMode]}
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {layoutMode === "2-pane" ? (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={40} minSize={25}>
              <ChatPanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={60} minSize={30}>
              <PreviewPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={18} minSize={12}>
              <FileTreePanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={37} minSize={20}>
              <ChatPanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={45} minSize={25}>
              <PreviewPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* Spawn Dialog */}
      <SpawnDialog open={showSpawn} onOpenChange={setShowSpawn} />
    </div>
  );
}
