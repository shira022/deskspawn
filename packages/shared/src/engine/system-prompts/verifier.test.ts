import { describe, it, expect } from "vitest";
import { verifierPrompt } from "./verifier";

describe("verifierPrompt", () => {
  it('returns string containing "QA engineer"', () => {
    const result = verifierPrompt();
    expect(result).toContain("QA engineer");
  });

  it("with simpleMode=true contains 'Simple Mode'", () => {
    const result = verifierPrompt(true);
    expect(result).toContain("Simple Mode (ON)");
  });

  it("with simpleMode=false does not contain 'Simple Mode'", () => {
    const result = verifierPrompt(false);
    expect(result).not.toContain("Simple Mode");
  });

  it("with simpleMode undefined does not contain 'Simple Mode'", () => {
    const result = verifierPrompt();
    expect(result).not.toContain("Simple Mode");
  });

  it("with language='ja' contains Japanese instruction", () => {
    const result = verifierPrompt(false, "ja");
    expect(result).toContain("Always respond in Japanese.");
  });

  it("with language='en' contains English instruction", () => {
    const result = verifierPrompt(false, "en");
    expect(result).toContain("Always respond in English.");
  });

  it("with language='fr' (unsupported) does not add language instruction", () => {
    const result = verifierPrompt(false, "fr");
    expect(result).not.toContain("Always respond in");
  });

  it('contains "Exit Condition" section', () => {
    const result = verifierPrompt();
    expect(result).toContain("Exit Condition");
  });

  it("contains get_errors tool description", () => {
    const result = verifierPrompt();
    expect(result).toContain("get_errors()");
  });

  it("contains Common Error Patterns section", () => {
    const result = verifierPrompt();
    expect(result).toContain("Common Error Patterns");
    expect(result).toContain("missing-package");
    expect(result).toContain("vite");
    expect(result).toContain("Type mismatch");
  });

  it("lists available tools", () => {
    const result = verifierPrompt();
    expect(result).toContain("read_file");
    expect(result).toContain("apply_artifact");
    expect(result).toContain("searchGitHub"); // tool described as NOT YET AVAILABLE
  });

  it("combines simple mode and language", () => {
    const result = verifierPrompt(true, "ja");
    expect(result).toContain("Simple Mode (ON)");
    expect(result).toContain("Always respond in Japanese.");
  });

  it("simple mode reports errors in plain language", () => {
    const result = verifierPrompt(true);
    expect(result).toContain("Fixed a typo");
    expect(result).toContain("causing the page to crash");
  });
});
