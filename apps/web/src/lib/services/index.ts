/**
 * Service registration — Web platform
 *
 * Call this at app startup to register all Web-specific service
 * implementations before any UI component tries to use them.
 */

import { ServiceRegistry } from "@deskspawn/ai-core";
import { WebAiService } from "./ai-service";
import { WebStorageService } from "./storage-service";
import { WebPreviewService } from "./preview-service";
import { isDesktopEnv } from "@/lib/platform";

export function registerWebServices(): void {
  ServiceRegistry.register("ai", new WebAiService());
  // C7 (web-storage audit 2026-08-12): on desktop, storage is real files via
  // Rust IPC (storage.ts routes internally) — never register the
  // WebStorageService, which touches localStorage/OPFS.
  if (!isDesktopEnv()) {
    ServiceRegistry.register("storage", new WebStorageService());
  }
  ServiceRegistry.register("preview", new WebPreviewService());
}
