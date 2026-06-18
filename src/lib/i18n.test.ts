/**
 * i18n test
 *
 * This module runs code at import time (i18n.init), so we need to
 * control globals BEFORE the module is evaluated.  We use
 * vi.resetModules() + dynamic import() with vi.stubGlobal to set up
 * localStorage before each test.
 *
 * NOTE: import.meta.glob is resolved at compile time by vitest,
 * so the actual locale files (ja/common.json, en/common.json) will
 * be loaded.  We test the behaviour of getInitialLanguage by
 * controlling localStorage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SETTINGS_KEY } from "./constants";

describe("i18n language detection", () => {
  /** A simple key-value store for localStorage mock */
  function createLocalStorageMock(initial?: Record<string, string>) {
    const store: Record<string, string> = { ...initial };
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((k) => delete store[k]);
      }),
      get length() {
        return Object.keys(store).length;
      },
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    };
  }

  /**
   * Import the i18n module with a specific localStorage state.
   * Resets module registry so the module-level init code runs fresh.
   */
  async function importI18n(localStorageMock: Record<string, unknown>) {
    vi.stubGlobal("localStorage", localStorageMock);
    vi.resetModules();
    return import("./i18n");
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses "ja" as default language when no settings are stored', async () => {
    const ls = createLocalStorageMock();
    const mod = await importI18n(ls);

    // The i18n instance should have language set to "ja"
    // (the fallback from getInitialLanguage since "ja" is available)
    expect(mod.default.language).toBe("ja");
  });

  it("reads language from stored settings", async () => {
    const ls = createLocalStorageMock({
      [SETTINGS_KEY]: JSON.stringify({ language: "en" }),
    });
    const mod = await importI18n(ls);

    expect(mod.default.language).toBe("en");
  });

  it("falls back to ja when stored language is not available", async () => {
    // Store a language that doesn't exist in the locale files
    const ls = createLocalStorageMock({
      [SETTINGS_KEY]: JSON.stringify({ language: "fr" }),
    });
    const mod = await importI18n(ls);

    // Should fall back to "ja" (first available ja locale)
    expect(mod.default.language).toBe("ja");
  });

  it("falls back to ja when settings JSON is malformed", async () => {
    const ls = createLocalStorageMock({
      [SETTINGS_KEY]: "{invalid json}",
    });
    const mod = await importI18n(ls);

    expect(mod.default.language).toBe("ja");
  });

  it("falls back to ja when settings key is missing", async () => {
    const ls = createLocalStorageMock({
      some_other_key: "irrelevant",
    });
    const mod = await importI18n(ls);

    expect(mod.default.language).toBe("ja");
  });

  it("exports the i18n instance as default", async () => {
    const ls = createLocalStorageMock();
    const mod = await importI18n(ls);

    expect(mod.default).toBeDefined();
    expect(typeof mod.default.language).toBe("string");
    expect(typeof mod.default.t).toBe("function");
  });
});
