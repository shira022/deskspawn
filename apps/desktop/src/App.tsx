/**
 * DeskSpawn Desktop — Root Application Component
 *
 * Shares the exact same UI as the Web app (MainLayout).
 * Platform-specific services are pre-registered for the Desktop environment.
 */

import React, { useEffect } from "react";
import { MainLayout } from "@deskspawn/shared/components/layout/MainLayout";
import { useAppStore } from "@deskspawn/shared/store/useAppStore";

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
