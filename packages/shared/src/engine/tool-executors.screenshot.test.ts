// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all dependencies (same style as tool-executors.test.ts) ───────────────

vi.mock("../lib/storage-opfs", () => ({
  readAppFile: vi.fn(),
  writeAppFile: vi.fn(),
  deleteAppFile: vi.fn(),
  listAppFiles: vi.fn(),
}));

vi.mock("../lib/storage", () => ({
  saveChatHistory: vi.fn(),
  getChatHistory: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

// html2canvas / pixelmatch は takeScreenshot だけが使う。jsdom には canvas 実装が
// 無いため、撮影対象そのものはモックし、待機ロジックだけを検証する。
const { html2canvasMock } = vi.hoisted(() => ({ html2canvasMock: vi.fn() }));
vi.mock("html2canvas", () => ({ default: html2canvasMock }));
vi.mock("pixelmatch", () => ({ default: vi.fn() }));

// ── Imports (after vi.mock) ────────────────────────────────────────────────────

import { takeScreenshot } from "./tool-executors";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFakeCanvas() {
  const ctx = {
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    })),
  };
  return {
    width: 1280,
    height: 720,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => "data:image/jpeg;base64,AAAA"),
  };
}

function mountIframe(): { iframe: HTMLIFrameElement; doc: Document } {
  const iframe = document.createElement("iframe");
  iframe.id = "preview-iframe";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<div id="root"></div>';
  return { iframe, doc };
}

function missingUiIssues(result: Awaited<ReturnType<typeof takeScreenshot>>) {
  return (result.detectedIssues ?? []).filter((i) => i.type === "missing-ui");
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("takeScreenshot render wait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    html2canvasMock.mockResolvedValue(makeFakeCanvas());
  });

  it("waits until #root has children before capturing (retries while empty)", async () => {
    const { doc } = mountIframe();
    const root = doc.getElementById("root")!;
    // 描画が遅れて現れる状況: 最初の #root は空で、少し後に子要素が入る
    setTimeout(() => {
      const h1 = doc.createElement("h1");
      h1.textContent = "Today's ToDo";
      root.appendChild(h1);
    }, 40);

    const result = await takeScreenshot({
      waitAfterLoad: 0,
      renderTimeoutMs: 2000,
      renderPollIntervalMs: 10,
    });

    expect(result.success).toBe(true);
    expect(html2canvasMock).toHaveBeenCalledTimes(1);
    // 空のまま撮っていれば missing-ui が付くはず。付いていない = 描画を待った。
    expect(missingUiIssues(result)).toHaveLength(0);
  });

  it("cuts off at the render timeout and still reports a genuinely blank page as an error", async () => {
    // #root は空のまま。待機しつつも上限で打ち切り、誤魔化さず FAIL させる。
    mountIframe();

    const result = await takeScreenshot({
      waitAfterLoad: 0,
      renderTimeoutMs: 60,
      renderPollIntervalMs: 10,
    });

    expect(result.success).toBe(true);
    expect(html2canvasMock).toHaveBeenCalledTimes(1);
    const missing = missingUiIssues(result);
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe("error");
  });

  it("forces an iframe reload and waits for the new load event before capturing", async () => {
    // jsdom は src 再代入で実際のナビゲーションを行わないため、load イベントを
    // 手動で発火できるフェイク iframe を使う。
    const doc = document.implementation.createHTMLDocument("preview");
    doc.body.innerHTML = '<div id="root"><h1>Ready</h1></div>';
    Object.defineProperty(doc, "readyState", { value: "complete", configurable: true });

    const listeners: Record<string, Array<(e: Event) => void>> = {};
    const fakeIframe = {
      src: "http://localhost:5174/",
      getAttribute: (name: string) =>
        name === "src" ? "http://localhost:5174/" : null,
      addEventListener: (type: string, cb: (e: Event) => void) => {
        (listeners[type] ||= []).push(cb);
      },
      removeEventListener: (type: string, cb: (e: Event) => void) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== cb);
      },
      contentDocument: doc,
      contentWindow: { document: doc },
    } as unknown as HTMLIFrameElement;
    const getEl = vi
      .spyOn(document, "getElementById")
      .mockReturnValue(fakeIframe);

    try {
      const promise = takeScreenshot({
        waitAfterLoad: 0,
        renderTimeoutMs: 2000,
        renderPollIntervalMs: 10,
      });
      let settled = false;
      promise.then(() => {
        settled = true;
      });

      // load イベントが来るまでは撮影に進まない
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(settled).toBe(false);

      // 新しい load イベントでリロード完了 → 撮影へ進む
      for (const cb of [...(listeners["load"] || [])]) cb(new Event("load"));

      const result = await promise;
      expect(result.success).toBe(true);
      expect(html2canvasMock).toHaveBeenCalledTimes(1);
    } finally {
      getEl.mockRestore();
    }
  });

  it("falls back to a fixed wait when the preview is cross-origin (contentDocument unavailable)", async () => {
    // 実機のプレビュー iframe は別オリジン: contentDocument は null になり、
    // contentWindow.document は SecurityError になる。DOM を覗けなくても
    // 「即 return」せず、固定時間だけ段階的に待ってから撮影することを検証する。
    const listeners: Record<string, Array<(e: Event) => void>> = {};
    const fakeIframe = {
      src: "",
      getAttribute: () => null,
      addEventListener: (type: string, cb: (e: Event) => void) => {
        (listeners[type] ||= []).push(cb);
      },
      removeEventListener: (type: string, cb: (e: Event) => void) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== cb);
      },
      get contentDocument() {
        return null;
      },
      get contentWindow() {
        return {
          get document(): Document {
            throw new DOMException("Blocked a frame with origin", "SecurityError");
          },
        };
      },
    } as unknown as HTMLIFrameElement;
    const getEl = vi.spyOn(document, "getElementById").mockReturnValue(fakeIframe);

    try {
      const startedAt = Date.now();
      const promise = takeScreenshot({
        waitAfterLoad: 0,
        renderFallbackWaitMs: 300,
        renderPollIntervalMs: 10,
      });
      let settled = false;
      promise.then(() => {
        settled = true;
      });

      // クロスオリジンでは load イベントだけが待機の起点になる
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
      for (const cb of [...(listeners["load"] || [])]) cb(new Event("load"));

      // 固定フォールバック待機の間はまだ撮影しない（300ms に対し 50ms 確認で余裕を取る）
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(html2canvasMock).not.toHaveBeenCalled();

      const result = await promise;
      expect(result.success).toBe(true);
      expect(html2canvasMock).toHaveBeenCalledTimes(1);
      // load 後の固定待機が実際に経過している（即 return していない）
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
    } finally {
      getEl.mockRestore();
    }
  });

  it("does not fall back to the 30s waitForIframeReady when reload receives the load event", async () => {
    // クロスオリジン（DOM を覗けない）で reload が load を受信した場合、
    // 既に消費した load を waitForIframeReady が再度待って 30 秒待たないことを
    // 検証する。src が無い場合はリロード未実施なのでフォールバック対象だが、
    // src がある場合は reload の load 受信を再利用して waitAfterLoad だけ待つ。
    const listeners: Record<string, Array<(e: Event) => void>> = {};
    const fakeIframe = {
      src: "http://localhost:5174/",
      getAttribute: (name: string) =>
        name === "src" ? "http://localhost:5174/" : null,
      addEventListener: (type: string, cb: (e: Event) => void) => {
        (listeners[type] ||= []).push(cb);
      },
      removeEventListener: (type: string, cb: (e: Event) => void) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== cb);
      },
      get contentDocument() {
        return null;
      },
      get contentWindow() {
        return {
          get document(): Document {
            throw new DOMException("Blocked a frame with origin", "SecurityError");
          },
        };
      },
    } as unknown as HTMLIFrameElement;
    const getEl = vi.spyOn(document, "getElementById").mockReturnValue(fakeIframe);

    try {
      const startedAt = Date.now();
      const promise = takeScreenshot({
        waitAfterLoad: 20,
        renderTimeoutMs: 50,
        renderPollIntervalMs: 10,
        renderFallbackWaitMs: 0,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      // reload の load イベント。waitForIframeReady に消費させない。
      for (const cb of [...(listeners["load"] || [])]) cb(new Event("load"));

      const result = await promise;
      expect(result.success).toBe(true);
      expect(html2canvasMock).toHaveBeenCalledTimes(1);
      // 30 秒の安全タイムアウトを経由していない（load 受信後は即 waitAfterLoad のみ）
      expect(Date.now() - startedAt).toBeLessThan(1000);
    } finally {
      getEl.mockRestore();
    }
  });

  it("does not wait for #root when the preview iframe is absent", async () => {
    const result = await takeScreenshot({ waitAfterLoad: 0 });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Preview iframe not found.");
    expect(html2canvasMock).not.toHaveBeenCalled();
  });
});
