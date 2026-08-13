/**
 * @deskspawn/browser-engine — Web storage service implementation
 *
 * Uses IndexedDB + OPFS for the browser platform.
 */

import type {
  StorageService,
  AppData,
  AppSettings,
} from "@deskspawn/ai-core";
import {
  saveApp as saveAppToDB,
  getApp as getAppFromDB,
  listApps as listAppsFromDB,
  deleteApp as deleteAppFromDB,
  getChatHistory,
} from "../../lib/storage";
import {
  readAppFile,
  writeAppFile,
  listAppFiles as listOPFSFiles,
} from "../../lib/storage-opfs";

const SETTINGS_KEY = "deskspawn_settings";

export class WebStorageService implements StorageService {
  async saveApp(app: AppData): Promise<void> {
    await saveAppToDB(app as any);
  }

  async loadApp(id: string): Promise<AppData | null> {
    const p = await getAppFromDB(id);
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

  async listApps(): Promise<AppData[]> {
    const apps = await listAppsFromDB();
    const result: AppData[] = [];
    for (const p of apps) {
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

  async deleteApp(id: string): Promise<void> {
    return deleteAppFromDB(id);
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

  async writeFile(appId: string, path: string, content: string): Promise<void> {
    await writeAppFile(appId, path, content);
  }

  async readFile(appId: string, path: string): Promise<string | null> {
    return readAppFile(appId, path);
  }

  async listFiles(appId: string): Promise<string[]> {
    const files = await listOPFSFiles(appId);
    return files.map((f) => f.path);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
