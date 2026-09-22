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
        "chat.usageTokens": "tokens",
        "chat.totalTokensAndCost": "Total tokens and estimated cost",
      };
      return translations[key] ?? key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// Mock Zustand store
interface MockUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost?: number | null;
}
const mockStore: {
  agentStatus: string;
  agentStepCount: number;
  agentMaxSteps: number;
  messages: Array<{ usage?: MockUsage }>;
} = {
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
    mockStore.messages = [];
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

  it("sums only known costs and prefixes ≥ when some costs are unknown", () => {
    mockStore.messages = [
      { usage: { inputTokens: 1000, outputTokens: 0, estimatedCost: 0.0057 } },
      { usage: { inputTokens: 10, outputTokens: 0 } },
    ];
    render(<StatusBar />);
    expect(screen.getByText("≥ $0.0057")).toBeInTheDocument();
  });

  it("does not prefix ≥ when every recorded usage has a known cost", () => {
    mockStore.messages = [
      { usage: { inputTokens: 1000, outputTokens: 0, estimatedCost: 0.0057 } },
      { usage: { inputTokens: 10, outputTokens: 0, estimatedCost: 0.0057 } },
    ];
    render(<StatusBar />);
    expect(screen.getByText("$0.0114")).toBeInTheDocument();
    expect(screen.queryByText("≥ $0.0114")).not.toBeInTheDocument();
  });

  it("shows '-' when every recorded usage has an unknown cost", () => {
    mockStore.messages = [
      { usage: { inputTokens: 1000, outputTokens: 0 } },
      { usage: { inputTokens: 20, outputTokens: 0 } },
    ];
    render(<StatusBar />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("treats a legacy null estimatedCost as unknown, not as a known $0", () => {
    mockStore.messages = [
      { usage: { inputTokens: 1000, outputTokens: 0, estimatedCost: null } },
    ];
    render(<StatusBar />);
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText("$0.0000")).not.toBeInTheDocument();
  });

  it("hides the cost display when there are no tokens", () => {
    mockStore.messages = [
      { usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 1 } },
    ];
    render(<StatusBar />);
    expect(screen.queryByText("$1.0000")).not.toBeInTheDocument();
  });
});
