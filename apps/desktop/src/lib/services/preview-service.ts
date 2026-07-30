/**
 * DeskSpawn Desktop — Preview service implementation
 *
 * Uses the Sidecar-managed Vite Dev Server to preview generated apps.
 * Falls back to a simple info message when Sidecar is offline.
 */

import type { PreviewService } from "@deskspawn/ai-core";
import { invoke } from "@tauri-apps/api/core";

export class DesktopPreviewService implements PreviewService {
  private currentUrl: string | null = null;

  async startPreview(
    projectId: string,
    files: Record<string, string>,
  ): Promise<{ url: string }> {
    // Write project files to disk then start preview server via Sidecar
    const result = await invoke<{ url: string }>("start_preview", {
      projectId,
      files,
    });
    this.currentUrl = result.url;
    return result;
  }

  async stopPreview(): Promise<void> {
    try {
      await invoke("stop_preview");
    } catch {
      // ignore
    }
    this.currentUrl = null;
  }

  getPreviewUrl(): string | null {
    return this.currentUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const status = await invoke<string>("sidecar_status");
      return status === "running";
    } catch {
      return false;
    }
  }
}
