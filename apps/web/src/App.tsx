import { useEffect } from "react";
import { AppRoot } from "@deskspawn/shared/components/app/AppRoot";
import { useAppStore } from "@deskspawn/shared/store/useAppStore";

/**
 * DeskSpawn Web — Root Application Component
 *
 * UI shell responsibilities (ErrorBoundary, ToastContainer, theme, font-size,
 * loading screen, MainLayout) live in the shared AppRoot. This entry only
 * performs web startup: initializing the app store.
 */
export function App() {
  const initialize = useAppStore((s) => s.initialize);

  // ── Initialize app ────────────────────────────────────────────────
  useEffect(() => {
    initialize();
  }, [initialize]);

  return <AppRoot />;
}