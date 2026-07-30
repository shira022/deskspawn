/**
 * DeskSpawn Desktop — Storage service implementation
 *
 * Uses Tauri IPC for OS-native storage:
 * - API keys → OS Keychain (via Rust keyring)
 * - Projects → Local filesystem (via Rust fs plugin)
 * - Settings → Tauri Store plugin
 */

import type {
  StorageService,
  ProjectData,
  AppSettings,
} from "@deskspawn/ai-core";
import { invoke } from "@tauri-apps/api/core";

export class DesktopStorageService implements StorageService {
  // ── Project CRUD ──────────────────────────────────────────────────

  async saveProject(project: ProjectData): Promise<void> {
    await invoke("save_project", { project });
  }

  async loadProject(id: string): Promise<ProjectData | null> {
    return invoke<ProjectData | null>("load_project", { id });
  }

  async listProjects(): Promise<ProjectData[]> {
    return invoke<ProjectData[]>("list_projects");
  }

  async deleteProject(id: string): Promise<void> {
    await invoke("delete_project", { id });
  }

  // ── Settings ──────────────────────────────────────────────────────

  async saveSettings(settings: AppSettings): Promise<void> {
    await invoke("save_settings", { settings });
  }

  async loadSettings(): Promise<AppSettings | null> {
    return invoke<AppSettings | null>("load_settings");
  }

  // ── API Key (OS Keychain via Rust) ────────────────────────────────

  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    await invoke("save_api_key", { provider, apiKey });
  }

  async loadApiKey(provider: string): Promise<string | null> {
    return invoke<string | null>("load_api_key", { provider });
  }

  async deleteApiKey(provider: string): Promise<void> {
    await invoke("delete_api_key", { provider });
  }

  // ── File operations ───────────────────────────────────────────────

  async writeFile(projectId: string, path: string, content: string): Promise<void> {
    await invoke("write_project_file", { projectId, path, content });
  }

  async readFile(projectId: string, path: string): Promise<string | null> {
    return invoke<string | null>("read_project_file", { projectId, path });
  }

  async listFiles(projectId: string): Promise<string[]> {
    return invoke<string[]>("list_project_files", { projectId });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await invoke("get_workspace_path");
      return true;
    } catch {
      return false;
    }
  }
}
