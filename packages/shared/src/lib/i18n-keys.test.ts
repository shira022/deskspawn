/**
 * chat.error 配下の i18n キーが ja/en 両方に存在し、生キーを返さず
 * プレースホルダが展開されることを検証する（回帰テスト）。
 */

import { describe, it, expect } from "vitest";
import i18n from "./i18n";

const REQUIRED_KEYS = [
  "chat.error.modelNotFound",
  "chat.error.phaseFailedDetail",
  "chat.error.rateLimit",
];

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

describe("chat.error i18n keys", () => {
  for (const lng of ["ja", "en"] as const) {
    it(`${lng}: required keys exist`, () => {
      const bundle = i18n.getResourceBundle(lng, "translation");
      for (const key of REQUIRED_KEYS) {
        expect(typeof getByPath(bundle, key), `${lng}:${key}`).toBe("string");
      }
    });
  }

  it("phaseFailedDetail expands phase/message (never the raw key)", () => {
    for (const lng of ["ja", "en"] as const) {
      const text = i18n.t("chat.error.phaseFailedDetail", {
        phase: "verifier",
        message: "boom",
        lng,
      });
      expect(text).not.toBe("chat.error.phaseFailedDetail");
      expect(text).not.toContain("phaseFailedDetail");
      expect(text).toContain("verifier");
      expect(text).toContain("boom");
    }
  });

  it("modelNotFound expands model", () => {
    for (const lng of ["ja", "en"] as const) {
      const text = i18n.t("chat.error.modelNotFound", { model: "gpt-4o", lng });
      expect(text).not.toBe("chat.error.modelNotFound");
      expect(text).toContain("gpt-4o");
    }
  });

  it("rateLimit expands all placeholders", () => {
    for (const lng of ["ja", "en"] as const) {
      const text = i18n.t("chat.error.rateLimit", {
        waitMs: "1000",
        retryCount: "1",
        maxRetries: "3",
        lng,
      });
      expect(text).not.toBe("chat.error.rateLimit");
      expect(text).toContain("1000");
      expect(text).toContain("3");
    }
  });
});
