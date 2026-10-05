import { describe, it, expect } from "vitest";
import { visualQAPrompt } from "./visual-qa";

describe("visualQAPrompt", () => {
  it('returns string containing "visual QA engineer"', () => {
    const result = visualQAPrompt();
    expect(result).toContain("visual QA engineer");
  });

  it("with simpleMode=true contains 'Simple Mode'", () => {
    const result = visualQAPrompt(true);
    expect(result).toContain("Simple Mode (ON)");
  });

  it("with simpleMode=false does not contain 'Simple Mode'", () => {
    const result = visualQAPrompt(false);
    expect(result).not.toContain("Simple Mode");
  });

  it("with simpleMode undefined does not contain 'Simple Mode'", () => {
    const result = visualQAPrompt();
    expect(result).not.toContain("Simple Mode");
  });

  it("with language='ja' contains Japanese instruction", () => {
    const result = visualQAPrompt(false, "ja");
    expect(result).toContain("Always respond in Japanese.");
  });

  it("with language='en' contains English instruction", () => {
    const result = visualQAPrompt(false, "en");
    expect(result).toContain("Always respond in English.");
  });

  it("with language='fr' (unsupported) does not add language instruction", () => {
    const result = visualQAPrompt(false, "fr");
    expect(result).not.toContain("Always respond in");
  });

  it('contains "Error Detection Checklist"', () => {
    const result = visualQAPrompt();
    expect(result).toContain("Error Detection Checklist");
  });

  it('contains "Exit Condition" section', () => {
    const result = visualQAPrompt();
    expect(result).toContain("Exit Condition");
  });

  it('contains "PASS / WARN / FAIL" exit conditions', () => {
    const result = visualQAPrompt();
    expect(result).toContain("PASS");
    expect(result).toContain("WARN");
    expect(result).toContain("FAIL");
  });

  it("contains take_screenshot tool", () => {
    const result = visualQAPrompt();
    expect(result).toContain("take_screenshot");
  });

  it("mentions error detection items", () => {
    const result = visualQAPrompt();
    expect(result).toContain("Console errors");
    expect(result).toContain("Vite error overlay");
    expect(result).toContain("Error boundary");
  });

  it("mentions responsive screenshots", () => {
    const result = visualQAPrompt();
    expect(result).toContain("viewports");
  });

  it("combines simple mode and language", () => {
    const result = visualQAPrompt(true, "ja");
    expect(result).toContain("Simple Mode (ON)");
    expect(result).toContain("Always respond in Japanese.");
  });

  it("simple mode avoids technical jargon", () => {
    const result = visualQAPrompt(true);
    expect(result).toContain("The page looks good!");
    expect(result).toContain("There's an error on the page");
  });
});
