/**
 * NewAppDialog — handleCreate() の順序テスト
 *
 * 新規アプリ作成時、テンプレート書き込み（writeAppFiles + src/lib/app-id.ts）
 * が currentAppId の公開（setAppId / setCurrentAppId / triggerReload）より
 * 先に完了していなければならない。公開が先だと PreviewPanel が即座に
 * previewManager.boot() を呼び、package.json の無いディレクトリに対して
 * サイドカーが 400 "Project has no package.json" を返してプレビューが
 * 固まってしまうためである。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewAppDialog } from "./NewAppDialog";

// ─── Mock react-i18next ───────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "app.createNewTitle": "Create New App",
        "app.createNewDesc": "Description",
        "app.appName": "App name",
        "app.appNamePlaceholder": "My new app",
        "app.appNameRequired": "App name is required",
        "app.templateReact": "React + Vite",
        "app.templateSQLite": "Hono + SQLite",
        "app.templateIndexedDB": "IndexedDB",
        "app.templateAutoBackup": "Auto backup",
        "app.templateShare": "Share",
        "app.creating": "Creating...",
        "app.create": "Create",
        "app.createError": "Failed to create app",
        "common.cancel": "Cancel",
      };
      return translations[key] ?? key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// ─── Mock storage / engine / template / platform ──────────────────────────────

const { saveAppMock, listAppsMock, setAppIdMock, writeAppFilesMock, writeAppFileMock, getTemplateFilesMock } =
  vi.hoisted(() => ({
    saveAppMock: vi.fn(async () => "app-real-1"),
    listAppsMock: vi.fn(async () => [{ id: "app-real-1", name: "My App", createdAt: "", updatedAt: "" }]),
    setAppIdMock: vi.fn(),
    writeAppFilesMock: vi.fn(async () => {}),
    writeAppFileMock: vi.fn(async () => {}),
    getTemplateFilesMock: vi.fn(() => [
      { path: "package.json", content: "{}" },
      { path: "src/main.tsx", content: "// entry" },
    ]),
  }));

vi.mock("../../lib/storage", () => ({
  saveApp: saveAppMock,
  listApps: listAppsMock,
}));

vi.mock("../../engine/tool-executors", () => ({
  setAppId: setAppIdMock,
}));

vi.mock("../../lib/storage-opfs", () => ({
  writeAppFiles: writeAppFilesMock,
  writeAppFile: writeAppFileMock,
}));

vi.mock("../../lib/template", () => ({
  getTemplateFiles: getTemplateFilesMock,
}));

vi.mock("../../lib/platform", () => ({
  isDesktopEnv: () => true,
}));

// ─── Mock Zustand store（NewAppDialog は useAppStore() を selector 無しで呼ぶ）──

const { storeMock } = vi.hoisted(() => ({
  storeMock: {
    setCurrentAppId: vi.fn(),
    setApps: vi.fn(),
    clearMessages: vi.fn(),
    setWorkspaceReady: vi.fn(),
    setAgentStatus: vi.fn(),
    setAgentStepCount: vi.fn(),
    setFileTree: vi.fn(),
    setSelectedFile: vi.fn(),
    setAppSwitching: vi.fn(),
    setAppLoading: vi.fn(),
    triggerReload: vi.fn(),
    settings: { language: "en" },
  },
}));

vi.mock("../../store/useAppStore", () => ({
  useAppStore: () => storeMock,
}));

// ─── Mock lucide-react icons ──────────────────────────────────────────────────

vi.mock("lucide-react", () => {
  const createIcon = (name: string) => () => <span data-testid={`icon-${name}`} />;
  return {
    Loader2: createIcon("loader-2"),
    Sparkles: createIcon("sparkles"),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 「アプリを作成」まで進める（アプリ名入力 → Create ボタン押下） */
async function createApp(onOpenChange: (open: boolean) => void) {
  render(<NewAppDialog open={true} onOpenChange={onOpenChange} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "My App" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NewAppDialog handleCreate ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes template files (incl. src/lib/app-id.ts) before publishing the app as current", async () => {
    const onOpenChange = vi.fn((_open: boolean) => {});
    await createApp(onOpenChange);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    // テンプレート書き込み完了 → その後に現行アプリとして公開されること
    const order = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0];
    expect(order(writeAppFilesMock)).toBeGreaterThan(0);
    expect(order(writeAppFileMock)).toBeLessThan(order(setAppIdMock));
    expect(order(writeAppFilesMock)).toBeLessThan(order(setAppIdMock));
    expect(order(writeAppFileMock)).toBeLessThan(order(storeMock.setCurrentAppId));
    expect(order(writeAppFilesMock)).toBeLessThan(order(storeMock.setCurrentAppId));
    expect(order(writeAppFileMock)).toBeLessThan(order(storeMock.triggerReload));

    // 実ディレクトリID（saveApp の戻り値）で書き込まれていること
    expect(writeAppFilesMock).toHaveBeenCalledWith("app-real-1", [
      { path: "package.json", content: "{}" },
      { path: "src/main.tsx", content: "// entry" },
    ]);
    expect(writeAppFileMock).toHaveBeenCalledWith(
      "app-real-1",
      "src/lib/app-id.ts",
      expect.stringContaining('APP_ID = "app-real-1"'),
    );

    // 既存セマンティクスの維持: セッションリセット・公開・ダイアログ閉鎖
    expect(setAppIdMock).toHaveBeenCalledWith("app-real-1");
    expect(storeMock.setCurrentAppId).toHaveBeenCalledWith("app-real-1");
    expect(storeMock.clearMessages).toHaveBeenCalled();
    expect(storeMock.setWorkspaceReady).toHaveBeenCalledWith(false);
    expect(storeMock.setWorkspaceReady).toHaveBeenCalledWith(true);
    expect(storeMock.setAgentStatus).toHaveBeenCalledWith("idle");
    expect(storeMock.setFileTree).toHaveBeenCalledWith([]);
    expect(storeMock.setSelectedFile).toHaveBeenCalledWith(null);
    expect(storeMock.triggerReload).toHaveBeenCalled();
    expect(storeMock.setAppLoading).toHaveBeenCalledWith(false);
    expect(storeMock.setAppSwitching).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and does NOT publish the app when template write fails", async () => {
    writeAppFilesMock.mockRejectedValueOnce(new Error("template write failed"));
    const onOpenChange = vi.fn((_open: boolean) => {});
    await createApp(onOpenChange);

    // エラーがダイアログ内に表示される
    expect(await screen.findByText("template write failed")).toBeInTheDocument();

    // 書き込みに失敗した場合は現行アプリとして公開しない（race 不可能化）
    await waitFor(() => expect(storeMock.setAppSwitching).toHaveBeenCalledWith(false));
    expect(setAppIdMock).not.toHaveBeenCalled();
    expect(storeMock.setCurrentAppId).not.toHaveBeenCalled();
    expect(storeMock.triggerReload).not.toHaveBeenCalled();
    expect(storeMock.setWorkspaceReady).not.toHaveBeenCalledWith(true);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
