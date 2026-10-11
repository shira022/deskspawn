// @vitest-environment jsdom
/**
 * ランディングページ（apps/web の / ルート）の描画テスト。
 *
 * i18n はキーをそのまま返すモックにして、DOM 構造・テーマ切替・言語切替が
 * 実際に動くことを検証する。実ネットワークは使わない。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const changeLanguageMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "ja", changeLanguage: changeLanguageMock },
  }),
}));

import { LandingPage } from "./landing";

const SETTINGS_KEY = "deskspawn_settings";

function stubLocalStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = String(value);
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  });
  return data;
}

beforeEach(() => {
  stubLocalStorage();
  changeLanguageMock.mockReset();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

describe("LandingPage", () => {
  it("ナビ・ヒーロー・機能・要件・CTA・フッターを描画する", () => {
    render(<LandingPage />);

    expect(screen.getAllByText("DeskSpawn").length).toBeGreaterThan(0);
    expect(screen.getByText("landing.badge")).toBeTruthy();
    expect(screen.getByText("landing.hero.title1")).toBeTruthy();
    expect(screen.getByText("landing.hero.title2")).toBeTruthy();
    expect(screen.getByText("landing.hero.subtitle")).toBeTruthy();
    expect(screen.getByText("landing.features.title")).toBeTruthy();
    expect(screen.getByText("landing.browserSection.title")).toBeTruthy();
    expect(screen.getByText("landing.requirements.title")).toBeTruthy();
    expect(screen.getByText("landing.cta.title")).toBeTruthy();
    expect(screen.getByText("landing.footer")).toBeTruthy();
    // 外部リンクは新規タブで開く
    expect(screen.getByTitle("GitHub").getAttribute("target")).toBe("_blank");
    expect(
      screen.getByRole("link", { name: /landing.hero.downloadButton/ }).getAttribute("href"),
    ).toBe("https://github.com/shira022/deskspawn/releases");
  });

  it("テーマ切替ボタンが HTML クラスと保存設定の両方を切り替える", () => {
    const data = stubLocalStorage();
    render(<LandingPage />);

    const toggle = screen.getByTitle("Switch to dark mode");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(JSON.parse(data[SETTINGS_KEY]).theme).toBe("dark");

    const back = screen.getByTitle("Switch to light mode");
    fireEvent.click(back);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(JSON.parse(data[SETTINGS_KEY]).theme).toBe("light");
  });

  it("言語切替ボタンが i18n と保存設定を切り替える", () => {
    const data = stubLocalStorage();
    render(<LandingPage />);

    fireEvent.click(screen.getByRole("button", { name: /English/ }));

    expect(changeLanguageMock).toHaveBeenCalledWith("en");
    expect(data["deskspawn_language"]).toBe("en");
    expect(JSON.parse(data[SETTINGS_KEY]).language).toBe("en");
  });

  it("保存済みテーマが dark なら初期状態からダークとして描画する", () => {
    stubLocalStorage({ [SETTINGS_KEY]: JSON.stringify({ theme: "dark" }) });
    render(<LandingPage />);

    expect(screen.getByTitle("Switch to light mode")).toBeTruthy();
    expect(screen.queryByTitle("Switch to dark mode")).not.toBeTruthy();
  });
});
