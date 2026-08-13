import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "statusBar.sidecarConnected": "Sidecar ✓",
        "statusBar.sidecarOffline": "Sidecar offline",
      };
      return translations[key] ?? key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// Mock Zustand store
const mockStore = {
  agentStatus: "idle",
  agentStepCount: 0,
  agentMaxSteps: 8,
  messages: [],
};

vi.mock("../../store/useAppStore", () => ({
  useAppStore: (selector?: (state: typeof mockStore) => unknown) =>
    selector ? selector(mockStore) : mockStore,
}));

// Mock lucide-react icons (rendered as empty spans)
vi.mock("lucide-react", () => {
  const createIcon = (name: string) => () => (
    <span data-testid={`icon-${name}`} />
  );
  return {
    Loader2: createIcon("loader-2"),
    Bot: createIcon("bot"),
    CheckCircle2: createIcon("check-circle-2"),
    AlertCircle: createIcon("alert-circle"),
    Wifi: createIcon("wifi"),
    Monitor: createIcon("monitor"),
  };
});

// Mock Tauri invoke (dynamic import in StatusBar)
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("StatusBar", () => {
  afterEach(() => {
    delete (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean })
      .__DESKSPAWN_DESKTOP__;
    delete (window as unknown as { __DESKSPAWN_SIDECAR_PORT__?: number })
      .__DESKSPAWN_SIDECAR_PORT__;
    invokeMock.mockReset();
  });

  it("shows Browser indicator in web environment", () => {
    render(<StatusBar />);
    expect(screen.getByText("Browser")).toBeTruthy();
  });

  it("shows Desktop indicator + sidecar status + port in desktop environment", async () => {
    (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean })
      .__DESKSPAWN_DESKTOP__ = true;
    (window as unknown as { __DESKSPAWN_SIDECAR_PORT__?: number })
      .__DESKSPAWN_SIDECAR_PORT__ = 3009;
    invokeMock.mockResolvedValue({ running: true, ready: true });

    render(<StatusBar />);

    expect(screen.getByText("Desktop")).toBeTruthy();
    expect(screen.getByText(":3009")).toBeTruthy();
    // sidecar_status の解決後、接続済みバッジが表示される
    expect(await screen.findByText("Sidecar ✓")).toBeTruthy();
  });

  it("shows sidecar offline when the Tauri invoke fails", async () => {
    (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean })
      .__DESKSPAWN_DESKTOP__ = true;
    invokeMock.mockRejectedValue(new Error("not in tauri"));

    render(<StatusBar />);

    expect(await screen.findByText("Sidecar offline")).toBeTruthy();
  });

  it("does not query sidecar status in web environment", () => {
    render(<StatusBar />);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
