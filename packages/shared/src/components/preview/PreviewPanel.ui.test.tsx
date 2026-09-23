import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
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
        "preview.rendering": "Rendering preview...",
        "preview.loadingApp": "Loading app...",
        "chat.generating": "Generating app...",
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
  agentStatus: "idle",
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

// ─── 生成中・再読込中のベール ─────────────────────────────────────────────────
// HMR が途中書き込みされたファイルを再読込して React がクラッシュし、生成中に
// 白画面＋赤エラーが見える問題への対策。ベールが iframe の兄弟要素であること
// （= takeScreenshot の html2canvas(previewIframe) に写り込まないこと）も併せて
// 検証する — ベールが撮影に写ると「白画面 FAIL」が復活する重大な回帰になる。

describe("PreviewPanel — generation veil (ベール)", () => {
  const veil = () => screen.queryByTestId("preview-veil");

  beforeEach(() => {
    (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean })
      .__DESKSPAWN_DESKTOP__ = true;
    mockStore.agentStatus = "idle";
    mockStore.reloadCounter = 0;
  });

  afterEach(() => {
    delete (window as unknown as { __DESKSPAWN_DESKTOP__?: boolean })
      .__DESKSPAWN_DESKTOP__;
    mockStore.agentStatus = "idle";
    mockStore.reloadCounter = 0;
    previewManagerMock.onStateChange.mockClear();
    previewManagerMock.boot.mockClear();
    previewManagerMock.syncAndReload.mockClear();
    mockStore.currentAppId = "app-1";
    resetPreviewManagerMock();
  });

  it("agentStatus: running → ベールが表示される（iframe 読み込み完了後も隠し続ける）", async () => {
    mockStore.agentStatus = "running";
    render(<PreviewPanel />);

    const veilEl = veil();
    expect(veilEl).toBeTruthy();
    expect(screen.getByText("Generating app...")).toBeTruthy();

    // 読み込み完了（load）後も生成中はベールを維持する
    fireEvent.load(screen.getByTitle("App Preview"));
    expect(veil()).toBeTruthy();
    expect(screen.getByText("Generating app...")).toBeTruthy();

    // クリックをブロックし、aria-live で進行状況を通知する
    expect(veilEl!.className).toContain("pointer-events-auto");
    expect(veilEl!.getAttribute("role")).toBe("status");
    expect(veilEl!.getAttribute("aria-live")).toBe("polite");
  });

  it("agentStatus: complete かつ iframeLoading: false → ベールは非表示", async () => {
    mockStore.agentStatus = "complete";
    render(<PreviewPanel />);

    // iframe の load で iframeLoading が false になる
    fireEvent.load(screen.getByTitle("App Preview"));
    expect(veil()).toBeNull();
    expect(screen.queryByText("Generating app...")).toBeNull();
  });

  it("iframeLoading: true（agentStatus が complete でも）→ ベール表示 — 完了マークと再読込の谷間をカバー", async () => {
    // useChatStream.ts では setAgentStatus("complete") が triggerReload より
    // 先に走る。complete 直後〜iframe 再読込完了までは中身が古い/壊れたまま
    // なので、iframeLoading が立っている間はベールで隠す。
    mockStore.agentStatus = "complete";
    const { rerender } = render(<PreviewPanel />);
    const iframe = screen.getByTitle("App Preview");

    // まず読み込み完了まで到達させてベールが無い状態を作る
    fireEvent.load(iframe);
    expect(veil()).toBeNull();

    // 完了後の triggerReload（reloadCounter 増加）→ iframeLoading 再立上
    mockStore.reloadCounter = 1;
    rerender(<PreviewPanel />);
    await waitFor(() => expect(veil()).toBeTruthy());

    // 生成は完了しているので文言はロード中のベール表示のまま（非表示にならない）
    expect(screen.queryByText("Generating app...")).toBeNull();
    expect(screen.getByText("Rendering preview...")).toBeTruthy();
  });

  it("running → complete 遷移直後（iframeLoading が false のまま）でもベールを継続 — 谷間の露出を塞ぐ", async () => {
    // useChatStream.ts は setAgentStatus("complete") → await fetchCheckpoints
    // → triggerReload の順。iframeLoading は triggerReload エフェクト内
    // （syncAndReload 前）で初めて立つため、complete 立上〜 triggerReload
    // 発火までの谷間では iframeLoading は false のままになる。
    mockStore.agentStatus = "running";
    const { rerender } = render(<PreviewPanel />);
    const iframe = screen.getByTitle("App Preview");

    // iframe の読み込み完了 → iframeLoading は false（生成中は running で維持）
    fireEvent.load(iframe);
    expect(veil()).toBeTruthy();

    // running → complete へ遷移（reloadCounter は据え置き＝ triggerReload 未発火）
    mockStore.agentStatus = "complete";
    rerender(<PreviewPanel />);

    // ★ 谷間の直接検出: リロードはまだ始まっていない（iframeLoading が
    //   立つタイミング以前）のに、ベールはまだ下りている
    expect(previewManagerMock.syncAndReload).not.toHaveBeenCalled();
    expect(veil()).toBeTruthy();
    expect(screen.getByText("Rendering preview...")).toBeTruthy();
  });

  it("complete + リロード完了（onLoad）→ ベール解除", async () => {
    mockStore.agentStatus = "running";
    const { rerender } = render(<PreviewPanel />);
    const iframe = screen.getByTitle("App Preview");

    // 読み込み完了 → running 中はベール維持
    fireEvent.load(iframe);
    expect(veil()).toBeTruthy();

    // running → complete（holdVeil 立上）
    mockStore.agentStatus = "complete";
    rerender(<PreviewPanel />);
    expect(veil()).toBeTruthy();

    // triggerReload（reloadCounter 増加）→ syncAndReload 実行
    mockStore.reloadCounter = 1;
    rerender(<PreviewPanel />);
    await waitFor(() => expect(previewManagerMock.syncAndReload).toHaveBeenCalled());
    // syncAndReload の .then（iframe.src 更新 → setIframeLoading(true)）まで消化
    await act(async () => {});
    expect(veil()).toBeTruthy();

    // ★ 再読込完了（onLoad）→ holdVeil / iframeLoading とも解除されベールが上がる
    fireEvent.load(screen.getByTitle("App Preview"));
    expect(veil()).toBeNull();
    expect(screen.queryByText("Generating app...")).toBeNull();
  });

  it("error 終了（リロード無し）→ ベール解除（固着しない）", async () => {
    mockStore.agentStatus = "running";
    const { rerender } = render(<PreviewPanel />);
    const iframe = screen.getByTitle("App Preview");

    fireEvent.load(iframe);
    expect(veil()).toBeTruthy();

    // running → complete で holdVeil が立つ（この後リロードは来ない）
    mockStore.agentStatus = "complete";
    rerender(<PreviewPanel />);
    expect(veil()).toBeTruthy();
    expect(previewManagerMock.syncAndReload).not.toHaveBeenCalled();

    // ★ エラー終了: triggerReload されないため holdVeil を確実に解除する
    mockStore.agentStatus = "error";
    rerender(<PreviewPanel />);
    expect(veil()).toBeNull();

    // 中断（stop → idle）でも固着しないこと
    mockStore.agentStatus = "running";
    rerender(<PreviewPanel />);
    expect(veil()).toBeTruthy();
    mockStore.agentStatus = "complete";
    rerender(<PreviewPanel />);
    expect(veil()).toBeTruthy();
    mockStore.agentStatus = "idle";
    rerender(<PreviewPanel />);
    expect(veil()).toBeNull();
  });

  it("生成中ベールは z-30（同期ログオーバーレイ z-20 の上）／完了後ロード中は z-10", async () => {
    mockStore.agentStatus = "running";
    const { rerender } = render(<PreviewPanel />);

    // ★ 生成中: z-30 でないと z-20 のログ枠越しに壊れた中身が透ける
    expect(veil()!.className).toContain("z-30");

    // 完了後（holdVeil 継続中）は通常時の z-10
    fireEvent.load(screen.getByTitle("App Preview"));
    mockStore.agentStatus = "complete";
    rerender(<PreviewPanel />);
    expect(veil()).toBeTruthy();
    expect(veil()!.className).toContain("z-10");
    expect(veil()!.className).not.toContain("z-30");
  });

  it("撮影前提: ベールは iframe の兄弟要素であり html2canvas(iframe) に写り込まない", async () => {
    mockStore.agentStatus = "running";
    render(<PreviewPanel />);

    const iframe = screen.getByTitle("App Preview");
    const veilEl = veil();
    expect(veilEl).toBeTruthy();

    // takeScreenshot は document.getElementById("preview-iframe") を
    // html2canvas に渡し、iframe 要素そのもの（＝その子孫）だけを撮る。
    // ベールが iframe の子孫でなければ撮影結果にベールは入り得ない。
    expect(iframe.contains(veilEl)).toBe(false);
    expect(veilEl!.parentElement).toBe(iframe.parentElement);
    // ベールが iframe の中に injected されていないこと（撮影回帰の防止）
    expect((iframe as HTMLElement).querySelector("[data-testid='preview-veil']")).toBeNull();
  });
});
