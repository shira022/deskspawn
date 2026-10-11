import { describe, it, expect } from "vitest";
import {
  SETTINGS_KEY,
  providerLabels,
  providerIcons,
  providerCategories,
  providerCategoryOrder,
  providerCategoryLabels,
  providerGroups,
  isProviderKind,
  providerNeedsApiKey,
} from "./constants";
import type { ProviderKind, ProviderCategory } from "../types";

/** aegis-agent と完全一致させる 9 種のプロバイダー ID */
const ALL_PROVIDERS: ProviderKind[] = [
  "openai",
  "anthropic",
  "google",
  "aws-bedrock",
  "azure-foundry",
  "gcp-vertexai",
  "ollama",
  "lm-studio",
  "openai-compatible",
];

describe("SETTINGS_KEY", () => {
  it('has the value "deskspawn_settings"', () => {
    expect(SETTINGS_KEY).toBe("deskspawn_settings");
  });

  it("is a non-empty string", () => {
    expect(typeof SETTINGS_KEY).toBe("string");
    expect(SETTINGS_KEY.length).toBeGreaterThan(0);
  });
});

describe("providerLabels", () => {
  it("contains all expected provider entries", () => {
    for (const id of ALL_PROVIDERS) {
      expect(providerLabels).toHaveProperty(id);
    }
  });

  it("has the correct display names (aegis displayName と一致)", () => {
    expect(providerLabels.openai).toBe("OpenAI");
    expect(providerLabels.anthropic).toBe("Anthropic");
    expect(providerLabels.google).toBe("Google");
    expect(providerLabels["aws-bedrock"]).toBe("AWS Bedrock");
    expect(providerLabels["azure-foundry"]).toBe("Azure Foundry");
    expect(providerLabels["gcp-vertexai"]).toBe("Google Cloud (Vertex AI)");
    expect(providerLabels.ollama).toBe("Ollama (Local)");
    expect(providerLabels["lm-studio"]).toBe("LM Studio (Local)");
    expect(providerLabels["openai-compatible"]).toBe(
      "Custom (OpenAI Compatible)",
    );
  });

  it("has exactly 9 entries", () => {
    expect(Object.keys(providerLabels).length).toBe(9);
  });

  it("all values are non-empty strings", () => {
    for (const [, label] of Object.entries(providerLabels)) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("has no legacy provider IDs", () => {
    for (const legacy of ["custom", "amazon-bedrock", "azure-openai", "google-vertex"]) {
      expect(providerLabels).not.toHaveProperty(legacy);
    }
  });
});

describe("providerIcons", () => {
  it("contains entries for all ProviderKind values", () => {
    for (const kind of ALL_PROVIDERS) {
      expect(providerIcons).toHaveProperty(kind);
    }
  });

  it("has the correct icon names", () => {
    expect(providerIcons.openai).toBe("Sparkles");
    expect(providerIcons.anthropic).toBe("Cloud");
    expect(providerIcons.google).toBe("Globe");
    expect(providerIcons["aws-bedrock"]).toBe("HardDrive");
    expect(providerIcons["azure-foundry"]).toBe("Container");
    expect(providerIcons["gcp-vertexai"]).toBe("Zap");
    expect(providerIcons.ollama).toBe("Cpu");
    expect(providerIcons["lm-studio"]).toBe("Cpu");
    expect(providerIcons["openai-compatible"]).toBe("Server");
  });

  it("has exactly 9 entries", () => {
    expect(Object.keys(providerIcons).length).toBe(9);
  });

  it("all values are non-empty strings", () => {
    for (const [, icon] of Object.entries(providerIcons)) {
      expect(typeof icon).toBe("string");
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  it("every key is a valid ProviderKind", () => {
    for (const key of Object.keys(providerIcons)) {
      expect(ALL_PROVIDERS).toContain(key as ProviderKind);
    }
  });
});

describe("providerCategories", () => {
  it("assigns every provider to an aegis-compatible category", () => {
    const expected: Record<ProviderKind, ProviderCategory> = {
      openai: "cloud",
      anthropic: "cloud",
      google: "cloud",
      "aws-bedrock": "cloud",
      "azure-foundry": "cloud",
      "gcp-vertexai": "cloud",
      ollama: "local",
      "lm-studio": "local",
      "openai-compatible": "compatible",
    };

    for (const id of ALL_PROVIDERS) {
      expect(providerCategories[id]).toBe(expected[id]);
    }
  });

  it("only uses the three categories cloud / local / compatible", () => {
    for (const category of Object.values(providerCategories)) {
      expect(["cloud", "local", "compatible"]).toContain(category);
    }
  });

  it("partitions all 9 providers into the 3 groups without gaps or duplicates", () => {
    const grouped = providerCategoryOrder.flatMap(
      (category) =>
        ALL_PROVIDERS.filter((id) => providerCategories[id] === category),
    );

    // 3グループすべてが使われ、9種が漏れず重複なく分かれる
    expect(providerCategoryOrder).toHaveLength(3);
    expect(grouped).toHaveLength(ALL_PROVIDERS.length);
    expect(new Set(grouped).size).toBe(ALL_PROVIDERS.length);
    expect([...grouped].sort()).toEqual([...ALL_PROVIDERS].sort());
  });

  it("labels all three categories", () => {
    for (const category of providerCategoryOrder) {
      expect(providerCategoryLabels[category]).toBeTruthy();
    }
    expect(providerCategoryLabels.cloud).toBe("Cloud");
    expect(providerCategoryLabels.local).toBe("Local");
    expect(providerCategoryLabels.compatible).toBe("OpenAI Compatible");
  });
});

describe("providerGroups", () => {
  it("covers every provider exactly once across the 3 groups", () => {
    const ids = providerGroups.flatMap((g) => g.providers);
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
    expect([...ids].sort()).toEqual([...ALL_PROVIDERS].sort());
  });

  it("uses the category order and labels", () => {
    expect(providerGroups.map((g) => g.category)).toEqual([
      "cloud",
      "local",
      "compatible",
    ]);
    expect(providerGroups.map((g) => g.label)).toEqual([
      "Cloud",
      "Local",
      "OpenAI Compatible",
    ]);
  });
});

describe("isProviderKind", () => {
  it("accepts every current provider ID", () => {
    for (const id of ALL_PROVIDERS) {
      expect(isProviderKind(id)).toBe(true);
    }
  });

  it("rejects legacy and unknown provider IDs", () => {
    for (const legacy of ["custom", "amazon-bedrock", "azure-openai", "google-vertex"]) {
      expect(isProviderKind(legacy)).toBe(false);
    }
    expect(isProviderKind("unknown")).toBe(false);
    expect(isProviderKind("")).toBe(false);
  });
});

describe("providerNeedsApiKey", () => {
  it("does not require an API key for local providers", () => {
    expect(providerNeedsApiKey("ollama")).toBe(false);
    expect(providerNeedsApiKey("lm-studio")).toBe(false);
  });

  it("requires an API key for every other provider", () => {
    for (const id of ALL_PROVIDERS) {
      if (id === "ollama" || id === "lm-studio") continue;
      expect(providerNeedsApiKey(id)).toBe(true);
    }
  });
});
