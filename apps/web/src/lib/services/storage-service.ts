/**
 * @deskspawn/browser-engine — Web storage service implementation
 *
 * Uses IndexedDB + OPFS for the browser platform.
 */

import type {
  StorageService,
  ProjectData,
  AppSettings,
} from "@deskspawn/ai-core";
import {
  saveProject as saveProjectToDB,
  getProject as getProjectFromDB,
  listProjects as listProjectsFromDB,
  deleteProject as deleteProjectFromDB,
  getChatHistory,
} from "../../lib/storage";
import {
  readProjectFile,
  writeProjectFile,
  listProjectFiles as listOPFSFiles,
} from "../../lib/storage-opfs";

const SETTINGS_KEY = "deskspawn_settings";

export class WebStorageService implements StorageService {
  async saveProject(project: ProjectData): Promise<void> {
    await saveProjectToDB(project as any);
  }

  async loadProject(id: string): Promise<ProjectData | null> {
    const p = await getProjectFromDB(id);
    if (!p) return null;
    const messages = await getChatHistory(id);
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      messages: messages ?? [],
    };
  }

  async listProjects(): Promise<ProjectData[]> {
    const projects = await listProjectsFromDB();
    const result: ProjectData[] = [];
    for (const p of projects) {
      const messages = await getChatHistory(p.id);
      result.push({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        messages: messages ?? [],
      });
    }
    return result;
  }

  async deleteProject(id: string): Promise<void> {
    return deleteProjectFromDB(id);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  async loadSettings(): Promise<AppSettings | null> {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    const { saveApiKey: saveKey } = await import("../../lib/storage");
    await saveKey(provider, apiKey);
  }

  async loadApiKey(provider: string): Promise<string | null> {
    const { loadApiKey: loadKey } = await import("../../lib/storage");
    return loadKey(provider);
  }

  async deleteApiKey(provider: string): Promise<void> {
    const { deleteApiKey: delKey } = await import("../../lib/storage");
    return delKey(provider);
  }

  async writeFile(projectId: string, path: string, content: string): Promise<void> {
    await writeProjectFile(projectId, path, content);
  }

  async readFile(projectId: string, path: string): Promise<string | null> {
    return readProjectFile(projectId, path);
  }

  async listFiles(projectId: string): Promise<string[]> {
    const files = await listOPFSFiles(projectId);
    return files.map((f) => f.path);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
