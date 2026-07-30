/**
 * Service registration — Desktop platform
 *
 * Call this at app startup to register all Desktop-specific service
 * implementations before any UI component tries to use them.
 */

import { ServiceRegistry } from "@deskspawn/ai-core";
import { DesktopAiService } from "./ai-service";
import { DesktopStorageService } from "./storage-service";
import { DesktopPreviewService } from "./preview-service";

export function registerDesktopServices(): void {
  ServiceRegistry.register("ai", new DesktopAiService());
  ServiceRegistry.register("storage", new DesktopStorageService());
  ServiceRegistry.register("preview", new DesktopPreviewService());
}
