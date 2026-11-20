import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EnvCheckScreen } from "./EnvCheckScreen";
import {
  registerRuntimeEnvProvider,
  type RuntimeCheckItem,
  type RuntimeEnvProvider,
} from "../../lib/runtime-env";

const enModules = import.meta.glob("../../locales/en/common.json", {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const enBundle = Object.values(enModules)[0]?.default ?? {};

function lookup(bundle: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, bundle);
}

function enT(key: string): string {
  const value = lookup(enBundle, key);
  return typeof value === "string" ? value : key;
}

vi.mock("react-i18next", async () => {
  const modules = import.meta.glob("../../locales/en/common.json", {
    eager: true,
  }) as Record<string, { default: Record<string, unknown> }>;
  const bundle = Object.values(modules)[0]?.default ?? {};

  const t = (key: string, opts?: Record<string, unknown>): string => {
    const value = lookup(bundle, key);
    let text = typeof value === "string" ? value : key;
    if (opts) {
      for (const [name, raw] of Object.entries(opts)) {
        text = text.split(`{{${name}}}`).join(String(raw));
      }
    }
    return text;
  };

  return {
    useTranslation: () => ({ t, i18n: { changeLanguage: vi.fn(), language: "en" } }),
    initReactI18next: { type: "3rdParty", init: () => undefined },
  };
});

const bunOk: RuntimeCheckItem = {
  id: "bun",
  label: "Bun",
  status: "ok",
  version: "1.3.14",
  source: "bundled",
  wingetId: "Oven-sh.Bun",
  sizeMb: 100,
  manualUrl: "https://bun.sh/docs/installation",
};

const webviewOk: RuntimeCheckItem = {
  id: "webview2",
  label: "Microsoft Edge WebView2 Runtime",
  status: "ok",
  version: "156.0.4314.58",
  source: "registry",
  wingetId: "Microsoft.EdgeWebView2Runtime",
  sizeMb: 2,
  manualUrl: "https://developer.microsoft.com/microsoft-edge/webview2/",
};

const bunMissing: RuntimeCheckItem = {
  ...bunOk,
  status: "missing",
  version: undefined,
  source: "none",
};

function makeProvider(
  overrides: Partial<RuntimeEnvProvider> = {},
): RuntimeEnvProvider {
  return {
    check: vi.fn().mockResolvedValue([bunOk, webviewOk]),
    install: vi.fn().mockResolvedValue([bunOk, webviewOk]),
    subscribeProgress: vi.fn().mockResolvedValue(vi.fn()),
    isWingetAvailable: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("EnvCheckScreen", () => {
  it("全項目 ok なら 1200ms 後に onReady を1回だけ呼ぶ", async () => {
    vi.useFakeTimers();
    const provider = makeProvider();
    registerRuntimeEnvProvider(provider);
    const onReady = vi.fn();

    render(<EnvCheckScreen onReady={onReady} />);
    await flush();

    expect(onReady).not.toHaveBeenCalled();
    expect(screen.getByTestId("env-check-screen")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(onReady).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("bun が missing なら自動セットアップで install('bun') を呼び、成功後に onReady を呼ぶ", async () => {
    vi.useFakeTimers();
    const install = vi.fn().mockResolvedValue([bunOk, webviewOk]);
    const provider = makeProvider({
      check: vi.fn().mockResolvedValue([bunMissing, webviewOk]),
      install,
    });
    registerRuntimeEnvProvider(provider);
    const onReady = vi.fn();

    render(<EnvCheckScreen onReady={onReady} />);
    await flush();

    expect(screen.getByTestId("env-status-bun")).toHaveTextContent(
      enT("env.notInstalled"),
    );

    fireEvent.click(screen.getByTestId("env-auto-setup-bun"));
    expect(screen.getByTestId("env-confirm-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("env-start-install"));
    await flush();

    expect(install).toHaveBeenCalledWith("bun");
    expect(onReady).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("install が reject したら installFailed とエラー内容を表示し、onReady は呼ばない", async () => {
    vi.useFakeTimers();
    const provider = makeProvider({
      check: vi.fn().mockResolvedValue([bunMissing, webviewOk]),
      install: vi.fn().mockRejectedValue(new Error("winget failed")),
    });
    registerRuntimeEnvProvider(provider);
    const onReady = vi.fn();

    render(<EnvCheckScreen onReady={onReady} />);
    await flush();

    fireEvent.click(screen.getByTestId("env-auto-setup-bun"));
    fireEvent.click(screen.getByTestId("env-start-install"));
    await flush();

    expect(screen.getByText(enT("env.installFailed"))).toBeInTheDocument();
    expect(screen.getByText(/winget failed/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onReady).not.toHaveBeenCalled();
  });

  it("provider 未登録（Web相当）なら即座に onReady を呼ぶ", async () => {
    vi.resetModules();
    const [{ render: freshRender }, { EnvCheckScreen: FreshScreen }] =
      await Promise.all([
        import("@testing-library/react"),
        import("./EnvCheckScreen"),
      ]);
    const onReady = vi.fn();

    freshRender(<FreshScreen onReady={onReady} />);

    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
