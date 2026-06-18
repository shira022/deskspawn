import { describe, it, expect } from "vitest";
import { templateLocale } from "./template-locale";
import type { TemplateLocale } from "./template-locale";

describe("templateLocale", () => {
  it('has "ja" and "en" keys', () => {
    expect(templateLocale).toHaveProperty("ja");
    expect(templateLocale).toHaveProperty("en");
  });

  it("has exactly 2 locale entries", () => {
    expect(Object.keys(templateLocale).length).toBe(2);
  });

  it("each TemplateLocale has all required string fields", () => {
    const requiredFields: (keyof TemplateLocale)[] = [
      "appWaitingTitle",
      "appWaitingDescLine1",
      "appWaitingDescLine2",
      "storeGuideComment",
      "storeReexportLabel",
      "hooksGuideComment",
      "hooksReexportLabel",
      "typesGuideComment",
      "typesReexportLabel",
    ];

    for (const [langCode, locale] of Object.entries(templateLocale)) {
      for (const field of requiredFields) {
        expect(locale).toHaveProperty(field);
        expect(typeof locale[field]).toBe("string");
        expect(locale[field].length).toBeGreaterThan(0);
      }
    }
  });

  it("all guide comments contain rules/pattern/example sections", () => {
    const guideFields: (keyof TemplateLocale)[] = [
      "storeGuideComment",
      "hooksGuideComment",
      "typesGuideComment",
    ];

    for (const [langCode, locale] of Object.entries(templateLocale)) {
      for (const field of guideFields) {
        const comment = locale[field];
        expect(comment).toContain("📁");
        expect(comment).toContain("📝");
        expect(comment).toContain("✨");
      }
    }
  });

  describe("Japanese locale", () => {
    const ja = templateLocale.ja;

    it("has Japanese text for appWaitingTitle", () => {
      expect(ja.appWaitingTitle).toBe("アプリの生成を待機しています");
    });

    it("has Japanese text for appWaitingDescLine1", () => {
      expect(ja.appWaitingDescLine1).toContain("AIチャット");
    });

    it("has Japanese text for appWaitingDescLine2", () => {
      expect(ja.appWaitingDescLine2).toContain("リアルタイムプレビュー");
    });

    it("has Japanese text in storeGuideComment", () => {
      expect(ja.storeGuideComment).toContain("ストア定義のルール");
      expect(ja.storeGuideComment).toContain("re-export");
    });

    it("has Japanese storeReexportLabel", () => {
      expect(ja.storeReexportLabel).toBe("ここに各機能のストアを re-export:");
    });

    it("has Japanese text in hooksGuideComment", () => {
      expect(ja.hooksGuideComment).toContain("カスタムフックのルール");
    });

    it("has Japanese hooksReexportLabel", () => {
      expect(ja.hooksReexportLabel).toBe("ここに各機能のフックを re-export:");
    });

    it("has Japanese text in typesGuideComment", () => {
      expect(ja.typesGuideComment).toContain("型定義のルール");
    });

    it("has Japanese typesReexportLabel", () => {
      expect(ja.typesReexportLabel).toBe("ここに各機能の型を re-export:");
    });
  });

  describe("English locale", () => {
    const en = templateLocale.en;

    it("has English text for appWaitingTitle", () => {
      expect(en.appWaitingTitle).toBe("Waiting for app generation");
    });

    it("has English text for appWaitingDescLine1", () => {
      expect(en.appWaitingDescLine1).toContain("AI chat");
    });

    it("has English text for appWaitingDescLine2", () => {
      expect(en.appWaitingDescLine2).toContain("live preview");
    });

    it("has English text in storeGuideComment", () => {
      expect(en.storeGuideComment).toContain("Store Definition Rules");
      expect(en.storeGuideComment).toContain("re-export");
    });

    it("has English storeReexportLabel", () => {
      expect(en.storeReexportLabel).toBe("Re-export feature stores here:");
    });

    it("has English text in hooksGuideComment", () => {
      expect(en.hooksGuideComment).toContain("Custom Hook Rules");
    });

    it("has English hooksReexportLabel", () => {
      expect(en.hooksReexportLabel).toBe("Re-export feature hooks here:");
    });

    it("has English text in typesGuideComment", () => {
      expect(en.typesGuideComment).toContain("Type Definition Rules");
    });

    it("has English typesReexportLabel", () => {
      expect(en.typesReexportLabel).toBe("Re-export feature types here:");
    });
  });

  it("Japanese and English have all the same field names", () => {
    const jaKeys = Object.keys(templateLocale.ja).sort();
    const enKeys = Object.keys(templateLocale.en).sort();
    expect(jaKeys).toEqual(enKeys);
  });
});
