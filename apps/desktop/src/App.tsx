/**
 * DeskSpawn Desktop — Root Application Component
 *
 * Shares the exact same UI as the Web app (MainLayout).
 * Platform-specific services are pre-registered for the Desktop environment.
 */

import React, { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAppStore } from "@/store/useAppStore";
import { registerDesktopServices } from "./lib/services";
import "./index.css";

// Register Desktop services once at module level
registerDesktopServices();

function DesktopInit({ children }: { children: React.ReactNode }) {
  const initialize = useAppStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return <>{children}</>;
}

export function App(): React.ReactElement {
  return (
    <DesktopInit>
      <MainLayout />
    </DesktopInit>
  );
}
