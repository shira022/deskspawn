import { describe, it, expect } from "vitest";
import { coderPrompt } from "./coder";

describe("coderPrompt", () => {
  it('returns a string containing "React/TypeScript"', () => {
    const result = coderPrompt();
    expect(result).toContain("React/TypeScript");
  });

  it("with planContext includes the plan text", () => {
    const plan = "This is the implementation plan content";
    const result = coderPrompt(plan);
    expect(result).toContain("Implementation Plan");
    expect(result).toContain(plan);
  });

  it("without planContext does not contain 'Implementation Plan'", () => {
    const result = coderPrompt();
    expect(result).not.toContain("Implementation Plan");
  });

  it("with planContext undefined does not contain 'Implementation Plan'", () => {
    const result = coderPrompt(undefined);
    expect(result).not.toContain("Implementation Plan");
  });

  it("with simpleMode=true contains 'Simple Mode (ON)'", () => {
    const result = coderPrompt(undefined, true);
    expect(result).toContain("Simple Mode (ON)");
  });

  it("with simpleMode=false does not contain 'Simple Mode'", () => {
    const result = coderPrompt(undefined, false);
    expect(result).not.toContain("Simple Mode");
  });

  it("with simpleMode undefined does not contain 'Simple Mode'", () => {
    const result = coderPrompt();
    expect(result).not.toContain("Simple Mode");
  });

  it("with language='ja' contains Japanese note", () => {
    const result = coderPrompt(undefined, false, "ja");
    expect(result).toContain("Respond in Japanese");
  });

  it("with language='en' contains English instruction", () => {
    const result = coderPrompt(undefined, false, "en");
    expect(result).toContain("Respond in English");
  });

  it("with language='fr' (unsupported) uses default language instruction", () => {
    const result = coderPrompt(undefined, false, "fr");
    expect(result).toContain("Respond in the user's language");
  });

  it("with language undefined uses default language instruction", () => {
    const result = coderPrompt();
    expect(result).toContain("Respond in the user's language");
  });

  it('contains "CRITICAL" sections', () => {
    const result = coderPrompt();
    expect(result).toContain("CRITICAL");
    // There are two CRITICAL sections
    const matches = result.match(/CRITICAL/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("contains pre-installed infrastructure files note", () => {
    const result = coderPrompt();
    expect(result).toContain("DO NOT MODIFY");
    expect(result).toContain("src/lib/storage");
  });

  it("contains dependency management rules", () => {
    const result = coderPrompt();
    expect(result).toContain("Dependency Management");
    expect(result).toContain("package.json");
  });

  it("contains Tech Stack section", () => {
    const result = coderPrompt();
    expect(result).toContain("Tech Stack");
    expect(result).toContain("Tailwind CSS v4");
    expect(result).toContain("IndexedDB");
  });

  it("combines planContext + simpleMode + language correctly", () => {
    const result = coderPrompt("Some plan", true, "ja");
    expect(result).toContain("Implementation Plan");
    expect(result).toContain("Some plan");
    expect(result).toContain("Simple Mode (ON)");
    expect(result).toContain("Respond in Japanese");
  });

  it("contains Available Tools section with apply_artifact", () => {
    const result = coderPrompt();
    expect(result).toContain("apply_artifact");
    expect(result).toContain("get_errors()");
    expect(result).toContain("read_file");
  });

  it("contains Layout & UI Rules section", () => {
    const result = coderPrompt();
    expect(result).toContain("Layout & UI Rules");
    expect(result).toContain("min-h-screen");
  });

  it("contains Workflow section", () => {
    const result = coderPrompt();
    expect(result).toContain("Workflow");
    expect(result).toContain("Loop until DONE");
  });

  it("simple mode example shows correct patterns", () => {
    const result = coderPrompt(undefined, true);
    expect(result).toContain("plain, easy-to-understand language");
    expect(result).toContain("Added a button to save your tasks");
    expect(result).toContain("Created a TodoList component");
  });
});
