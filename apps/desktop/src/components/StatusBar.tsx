/**
 * DeskSpawn Desktop — Status Bar
 */

import React from "react";
import { Wifi, WifiOff } from "lucide-react";

interface StatusBarProps {
  sidecarOnline: boolean;
}

export function StatusBar({ sidecarOnline }: StatusBarProps) {
  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t px-4 text-xs text-muted-foreground">
      <span>DeskSpawn Desktop v0.2.0</span>
      <div className="flex items-center gap-1.5">
        {sidecarOnline ? (
          <>
            <Wifi className="h-3 w-3 text-success" />
            <span className="text-success">Sidecar Online</span>
          </>
        ) : (
          <>
            <WifiOff className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Sidecar Offline</span>
          </>
        )}
      </div>
    </footer>
  );
}
