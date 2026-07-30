/**
 * @deskspawn/browser-engine — Web preview service implementation
 *
 * Uses WebContainer (via PreviewManager).
 */

import type { PreviewService } from "@deskspawn/ai-core";
import { PreviewManager } from "../../lib/preview/webcontainer";

export class WebPreviewService implements PreviewService {
  private previewManager = new PreviewManager();

  async startPreview(
    projectId: string,
    _files: Record<string, string>,
  ): Promise<{ url: string }> {
    await this.previewManager.boot(projectId);
    const url = this.previewManager.url;
    if (!url) throw new Error("Preview failed to start");
    return { url };
  }

  async stopPreview(): Promise<void> {
    this.previewManager.teardown();
  }

  getPreviewUrl(): string | null {
    return this.previewManager.url;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
