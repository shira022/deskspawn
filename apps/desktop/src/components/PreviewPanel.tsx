/**
 * DeskSpawn Desktop — Preview Panel
 */

import React from "react";
import { Button } from "@deskspawn/ui";
import { ExternalLink, EyeOff } from "lucide-react";

interface PreviewPanelProps {
  url: string | null;
}

export function PreviewPanel({ url }: PreviewPanelProps) {
  if (!url) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
          <EyeOff className="h-12 w-12" />
          <p className="text-sm">No preview running</p>
          <p className="text-xs">Generate an app and start the preview from the chat panel.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-xs text-muted-foreground">
          Preview: {url}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => window.open(url, "_blank")}
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          Open in Browser
        </Button>
      </div>

      {/* WebView content area */}
      <div className="flex-1 bg-white">
        <iframe
          src={url}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
          title="App Preview"
        />
      </div>
    </div>
  );
}
