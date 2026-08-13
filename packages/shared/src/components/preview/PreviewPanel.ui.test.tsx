import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { port?: string }) => {
      const translations: Record<string, string> = {
        "preview.title": "Preview",
        "preview.selectApp": "Select or create an app to preview",
        "preview.localBadge": "Local :{{port}}",
        "preview.openInBrowser": "Open in browser",
        "common.refresh": "Refresh",
        "common.minimize": "Minimize",
        "common.maximize": "Maximize",
      };
      let v = translations[key] ?? key;
      if (opts?.port) v = v.replace("{{port}}", opts.port);
      return v;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// Mock Zustand store
const mockStore = {
  currentAppId: "app-1",
  initialized: true,
  reloadCounter: 0,
  previewMaximized: false,
  togglePreviewMaximized: vi.fn(),
  messages: [],
};

vi.mock("../../store/useAppStore", () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) =>
    selector(mockStore),
}));

// Mock previewManager (Proxy singleton) — emit ready state immediately
const { previewManagerMock } = vi.hoisted(() => ({
  previewManagerMock: {
    onStateChange: vi.fn(
      (cb: (state: {
        status: string;
        url: string | null;
        error: string | null;
        logs: string[];
      }) => void) => {
        cb({
          status: "ready",
          url: "http://localhost:4174/",
          error: null,
          logs: [],
        });
        return () => {};
      },
    ),
    boot: vi.fn().mockResolvedValue(undefined),
    syncAndReload: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/preview", () => ({
  previewManager: previewManagerMock,
}));

// Mock compatibility check
vi.mock("../../lib/compatibility", () => ({
  checkCompatibility: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => {
  const createIcon = (name: string) => () => (
    <span data-testid={`icon-${name}`} />
  );
  return {
    Loader2: createIcon("loader-2"),
    RefreshCw: createIcon("refresh-cw"),
    AlertTriangle: createIcon("alert-triangle"),
    Maximize2: createIcon("maximize-2"),
    Minimize2: createIcon("minimize-2"),
    Wifi: createIcon("wifi"),
    WifiOff: createIcon("wifi-off"),
    Package: createIcon("package"),
    Terminal: createIcon("terminal"),
    Smartphone: createIcon("smartphone"),
    Tablet: createIcon("tablet"),
    ExternalLink: createIcon("external-link"),
    ZoomIn: createIcon("zoom-in"),
    ZoomOut: createIcon("zoom-out"),
  };
});

describe("PreviewPanel", () => {
  afterEach(() => {
    delete (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean })
      .__DESKSPAWN_DESKTOP__;
    previewManagerMock.onStateChange.mockClear();
    previewManagerMock.boot.mockClear();
  });

  it("shows HMR badge in web environment", async () => {
    render(<PreviewPanel />);
    expect(await screen.findByText("HMR")).toBeTruthy();
  });

  it("shows Local badge + open-in-browser button in desktop environment", async () => {
    (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean })
      .__DESKSPAWN_DESKTOP__ = true;

    render(<PreviewPanel />);

    expect(await screen.findByText("Local :4174")).toBeTruthy();
    // ブラウザで開くボタン（title属性で判定）
    expect(screen.getByTitle("Open in browser")).toBeTruthy();
    // Web 専用の HMR バッジは出ない
    expect(screen.queryByText("HMR")).toBeNull();
  });
});
