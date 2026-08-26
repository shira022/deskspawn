/**
 * DeskSpawn Desktop — Root Application Component
 *
 * Shares the exact same UI shell as the Web app (AppRoot: ErrorBoundary,
 * ToastContainer, theme, font-size, loading screen, MainLayout).
 * Platform-specific services are pre-registered for the Desktop environment.
 */

import React, { useEffect } from "react";
import { AppRoot } from "@deskspawn/shared/components/app/AppRoot";
import { useAppStore } from "@deskspawn/shared/store/useAppStore";
import { registerDesktopServices } from "./lib/services";

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
      <AppRoot />
    </DesktopInit>
  );
}