import { describe, it, expect } from "vitest";
import { languages, languageSelectPhrases, languageSelectSubtitles } from "./languages";
import type { LanguageCode } from "./languages";

describe("languages", () => {
  it("has exactly 2 entries", () => {
    expect(languages.length).toBe(2);
  });

  it("each entry has all required fields", () => {
    for (const lang of languages) {
      expect(lang).toHaveProperty("code");
      expect(lang).toHaveProperty("labelKey");
      expect(lang).toHaveProperty("nativeName");
      expect(lang).toHaveProperty("countryCode");
      expect(lang).toHaveProperty("subtitle");
    }
  });

  it("each entry has a non-empty code", () => {
    for (const lang of languages) {
      expect(typeof lang.code).toBe("string");
      expect(lang.code.length).toBeGreaterThan(0);
    }
  });

  it("each entry has a non-empty labelKey", () => {
    for (const lang of languages) {
      expect(typeof lang.labelKey).toBe("string");
      expect(lang.labelKey.length).toBeGreaterThan(0);
    }
  });

  it("each entry has a non-empty nativeName", () => {
    for (const lang of languages) {
      expect(typeof lang.nativeName).toBe("string");
      expect(lang.nativeName.length).toBeGreaterThan(0);
    }
  });

  it("each entry has a non-empty countryCode", () => {
    for (const lang of languages) {
      expect(typeof lang.countryCode).toBe("string");
      expect(lang.countryCode.length).toBeGreaterThan(0);
    }
  });

  it("each entry has a non-empty subtitle", () => {
    for (const lang of languages) {
      expect(typeof lang.subtitle).toBe("string");
      expect(lang.subtitle.length).toBeGreaterThan(0);
    }
  });

  it("has Japanese as the first entry", () => {
    const ja = languages[0];
    expect(ja.code).toBe("ja");
    expect(ja.nativeName).toBe("日本語");
    expect(ja.countryCode).toBe("jp");
    expect(ja.labelKey).toBe("languages.ja");
    expect(ja.subtitle).toBe("おかえりなさい。");
  });

  it("has English as the second entry", () => {
    const en = languages[1];
    expect(en.code).toBe("en");
    expect(en.nativeName).toBe("English");
    expect(en.countryCode).toBe("us");
    expect(en.labelKey).toBe("languages.en");
    expect(en.subtitle).toBe("This is the way.");
  });

  it("codes are unique", () => {
    const codes = languages.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("LanguageCode type resolves to valid codes", () => {
    // At type level, LanguageCode should be "ja" | "en"
    const codes = languages.map((l) => l.code) as LanguageCode[];
    expect(codes.includes("ja")).toBe(true);
    expect(codes.includes("en")).toBe(true);
    expect(codes.includes("fr" as LanguageCode)).toBe(false);
  });
});

describe("languageSelectPhrases", () => {
  it("has at least 2 phrases", () => {
    expect(languageSelectPhrases.length).toBeGreaterThanOrEqual(2);
  });

  it("all phrases are non-empty strings", () => {
    for (const phrase of languageSelectPhrases) {
      expect(typeof phrase).toBe("string");
      expect(phrase.length).toBeGreaterThan(0);
    }
  });

  it("has unique phrases", () => {
    expect(new Set(languageSelectPhrases).size).toBe(languageSelectPhrases.length);
  });
});

describe("languageSelectSubtitles", () => {
  it("has the same length as languageSelectPhrases", () => {
    expect(languageSelectSubtitles.length).toBe(languageSelectPhrases.length);
  });

  it("all subtitles are non-empty strings", () => {
    for (const s of languageSelectSubtitles) {
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it("has unique subtitles", () => {
    expect(new Set(languageSelectSubtitles).size).toBe(languageSelectSubtitles.length);
  });
});
