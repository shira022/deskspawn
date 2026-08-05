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

export function registerWebServices(): void {
  ServiceRegistry.register("ai", new WebAiService());
  ServiceRegistry.register("storage", new WebStorageService());
  ServiceRegistry.register("preview", new WebPreviewService());
}
