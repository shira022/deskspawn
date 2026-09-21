import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { port?: string }) => {
      const translations: Record<string, string> = {
        "preview.title": "Preview",
        "preview.selectApp": "Select or create an app to preview",
        "preview.loading": "Preparing preview...",
        "preview.waitingForServer": "Waiting for the app's dev server...",
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

// Mock previewManager (Proxy singleton) — 実装と同じく「購読時に現在状態を即通知」し、
// テストから manager の状態変化（boot 開始時の url クリア → ready の実 url など）を
// 流し込めるようにリスナーを保持する。
const { previewManagerMock, emitPreviewState, resetPreviewManagerMock } =
  vi.hoisted(() => {
    type MockState = {
      status: string;
      url: string | null;
      error: string | null;
      logs: string[];
    };
    const DEFAULT_STATE: MockState = {
      status: "ready",
      url: "http://localhost:4174/",
      error: null,
      logs: [],
    };
    const listeners = new Set<(s: MockState) => void>();
    let current: MockState = { ...DEFAULT_STATE };
    return {
      previewManagerMock: {
        onStateChange: vi.fn((cb: (s: MockState) => void) => {
          listeners.add(cb);
          // 初回は即座に現在の状態を通知（実装と同じ挙動）
          cb(current);
          return () => {
            listeners.delete(cb);
          };
        }),
        boot: vi.fn().mockResolvedValue(undefined),
        syncAndReload: vi.fn().mockResolvedValue(undefined),
      },
      /** manager の状態を切り替え、購読中のリスナーへ通知する */
      emitPreviewState: (s: MockState) => {
        current = s;
        for (const l of listeners) l(s);
      },
      /** 状態とリスナーをデフォルト（ready / 4174）へ戻す */
      resetPreviewManagerMock: () => {
        listeners.clear();
        current = { ...DEFAULT_STATE };
      },
    };
  });

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
    ShieldAlert: createIcon("shield-alert"),
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
    mockStore.currentAppId = "app-1";
    resetPreviewManagerMock();
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

  it("renders the preview iframe with allow-same-origin and allow-scripts sandbox", async () => {
    render(<PreviewPanel />);

    const iframe = await screen.findByTitle("App Preview");
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    // allow-same-origin が無いと sandbox フレームのオリジンが null になり、
    // Vite の ES モジュールリクエストが CORS でブロックされる（白画面化）
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).toContain("allow-scripts");
  });
});

// ─── アプリ切替時の前アプリ残存防止 ───────────────────────────────────────────
// 切替〜起動完了のあいだプレビュー枠に前アプリの内容が残る問題（前アプリの
// ドキュメントを映し続ける / 同一ポートだと src が同じ文字列になり再ナビゲー
// ションされない）への対策を検証する。pane の URL/ポート表示と iframe の参照先は
// 「そのアプリに対して実際に起動したサーバー」（sidecar が返す実ポート）に一致する。

describe("PreviewPanel — app switch does not leak the previous app", () => {
  beforeEach(() => {
    // LogViewer の自動スクロールが jsdom 未実装の scrollIntoView を呼んで
    // 落ちるのを防ぐ（このファイルでのみ影響）
    Element.prototype.scrollIntoView = vi.fn();
    (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean })
      .__DESKSPAWN_DESKTOP__ = true;
  });

  afterEach(() => {
    delete (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean })
      .__DESKSPAWN_DESKTOP__;
    previewManagerMock.onStateChange.mockClear();
    previewManagerMock.boot.mockClear();
    mockStore.currentAppId = "app-1";
    resetPreviewManagerMock();
  });

  it("サーバー未起動（url 無し）の間は iframe を描画せず「準備中」表示を出す", async () => {
    // app-1 が ready（4174）で表示されていた状態から出発
    const { rerender } = render(<PreviewPanel />);
    expect(await screen.findByTitle("App Preview")).toBeTruthy();

    // アプリ切替 → manager が boot 開始時に url をクリアして booting を通知
    mockStore.currentAppId = "app-2";
    act(() => {
      rerender(<PreviewPanel />);
      emitPreviewState({
        status: "booting",
        url: null,
        error: null,
        logs: [],
      });
    });

    // ★ 起動中: 前アプリの iframe は描画されない（前アプリのドキュメントを映さない）
    expect(screen.queryByTitle("App Preview")).toBeNull();
    // 実ポートが確定するまで Local :port バッジも出さない
    expect(screen.queryByText("Local :4174")).toBeNull();
    // 既存のローディング表現（LogViewer）による「準備中」表示が出ている
    expect(screen.getByText("Preparing preview...")).toBeTruthy();
  });

  it("boot 完了後に新 URL で iframe がマウントされる（url 無し期間を経由して再ナビゲーション）", async () => {
    const { rerender } = render(<PreviewPanel />);
    const firstIframe = await screen.findByTitle("App Preview");
    expect(firstIframe.getAttribute("src")).toBe("http://localhost:4174/");

    // app-2 へ切替 → booting（url クリア）: 一度 iframe が消える
    mockStore.currentAppId = "app-2";
    act(() => {
      rerender(<PreviewPanel />);
      emitPreviewState({ status: "booting", url: null, error: null, logs: [] });
    });
    expect(screen.queryByTitle("App Preview")).toBeNull();

    // boot 完了: 同じポート文字列（5174 固定のケース）で ready
    act(() => {
      emitPreviewState({
        status: "ready",
        url: "http://localhost:4174/",
        error: null,
        logs: [],
      });
    });

    // ★ 同一ポートでも url が null を経由したため iframe は新規マウントされる
    //   （= 再ナビゲーションが起こり、新アプリのドキュメントを読み直す）
    const secondIframe = screen.getByTitle("App Preview");
    expect(secondIframe.getAttribute("src")).toBe("http://localhost:4174/");
    expect(secondIframe).not.toBe(firstIframe);
    // バッジは実ポート（URL 由来）に追従する
    expect(screen.getByText("Local :4174")).toBeTruthy();
  });

  it("url が null を経由せずともアプリが変われば key で再マウントされる（同一ポート文字列の防御）", async () => {
    const { rerender } = render(<PreviewPanel />);
    const firstIframe = await screen.findByTitle("App Preview");
    expect(firstIframe.getAttribute("src")).toBe("http://localhost:4174/");

    // url クリアを経由しない遷移（旧 manager の挙動を模倣）: app-1 → app-2 で
    // 同じ文字列の URL がそのまま残る場合でも、key 変更で再マウントさせる
    mockStore.currentAppId = "app-2";
    act(() => {
      rerender(<PreviewPanel />);
      emitPreviewState({
        status: "ready",
        url: "http://localhost:4174/",
        error: null,
        logs: [],
      });
    });

    // ★ src は同一文字列だが key（appId:url）が変わったため DOM ノードは
    //   作り直されている = 必ず再ナビゲーションが起きる
    const secondIframe = screen.getByTitle("App Preview");
    expect(secondIframe.getAttribute("src")).toBe("http://localhost:4174/");
    expect(secondIframe).not.toBe(firstIframe);
  });

  it("URL が実ポート（フォールバック先）に変われば iframe の src とバッジも追従する", async () => {
    render(<PreviewPanel />);
    await screen.findByTitle("App Preview");
    expect(screen.getByText("Local :4174")).toBeTruthy();

    // 5174 が埋まって 5175 にフォールバックした実ポートへ URL が変わる
    act(() => {
      emitPreviewState({
        status: "ready",
        url: "http://localhost:5175/",
        error: null,
        logs: [],
      });
    });

    // ★ pane の表示（バッジ）と iframe の参照先が実際に起動したサーバーの
    //   実ポートへ一致する（ポートのハードコード無し）
    const iframe = screen.getByTitle("App Preview");
    expect(iframe.getAttribute("src")).toBe("http://localhost:5175/");
    expect(screen.getByText("Local :5175")).toBeTruthy();
    expect(screen.queryByText("Local :4174")).toBeNull();
  });
});
