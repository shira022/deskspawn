import { describe, it, expect } from "vitest";
import { SETTINGS_KEY, providerLabels, providerIcons } from "./constants";
import type { ProviderKind } from "@/types";

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
    expect(providerLabels).toHaveProperty("openai");
    expect(providerLabels).toHaveProperty("anthropic");
    expect(providerLabels).toHaveProperty("google");
    expect(providerLabels).toHaveProperty("amazon-bedrock");
    expect(providerLabels).toHaveProperty("azure-openai");
    expect(providerLabels).toHaveProperty("google-vertex");
    expect(providerLabels).toHaveProperty("ollama");
    expect(providerLabels).toHaveProperty("custom");
  });

  it("has the correct display names", () => {
    expect(providerLabels.openai).toBe("OpenAI");
    expect(providerLabels.anthropic).toBe("Anthropic");
    expect(providerLabels.google).toBe("Google");
    expect(providerLabels["amazon-bedrock"]).toBe("AWS Bedrock");
    expect(providerLabels["azure-openai"]).toBe("Azure OpenAI");
    expect(providerLabels["google-vertex"]).toBe("GCP Vertex AI");
    expect(providerLabels.ollama).toBe("Ollama");
    expect(providerLabels.custom).toBe("Custom");
  });

  it("has exactly 8 entries", () => {
    expect(Object.keys(providerLabels).length).toBe(8);
  });

  it("all values are non-empty strings", () => {
    for (const [, label] of Object.entries(providerLabels)) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("providerIcons", () => {
  it("contains entries for all ProviderKind values", () => {
    const providerKinds: ProviderKind[] = [
      "openai",
      "anthropic",
      "google",
      "amazon-bedrock",
      "azure-openai",
      "google-vertex",
      "ollama",
      "custom",
    ];

    for (const kind of providerKinds) {
      expect(providerIcons).toHaveProperty(kind);
    }
  });

  it("has the correct icon names", () => {
    expect(providerIcons.openai).toBe("Sparkles");
    expect(providerIcons.anthropic).toBe("Cloud");
    expect(providerIcons.google).toBe("Globe");
    expect(providerIcons["amazon-bedrock"]).toBe("HardDrive");
    expect(providerIcons["azure-openai"]).toBe("Container");
    expect(providerIcons["google-vertex"]).toBe("Zap");
    expect(providerIcons.ollama).toBe("Cpu");
    expect(providerIcons.custom).toBe("Server");
  });

  it("has exactly 8 entries", () => {
    expect(Object.keys(providerIcons).length).toBe(8);
  });

  it("all values are non-empty strings", () => {
    for (const [, icon] of Object.entries(providerIcons)) {
      expect(typeof icon).toBe("string");
      expect(icon.length).toBeGreaterThan(0);
    }
  });

  it("every key is a valid ProviderKind", () => {
    const validProviderKinds = new Set<ProviderKind>([
      "openai",
      "anthropic",
      "google",
      "amazon-bedrock",
      "azure-openai",
      "google-vertex",
      "ollama",
      "custom",
    ]);

    for (const key of Object.keys(providerIcons)) {
      expect(validProviderKinds.has(key as ProviderKind)).toBe(true);
    }
  });
});
