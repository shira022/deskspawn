import { describe, it, expect } from "vitest";
import { plannerPrompt } from "./planner";

describe("plannerPrompt", () => {
  it('returns a string containing "senior software architect"', () => {
    const result = plannerPrompt();
    expect(result).toContain("senior software architect");
  });

  it('returns a string containing "Available Tools"', () => {
    const result = plannerPrompt();
    expect(result).toContain("Available Tools");
  });

  it("with simpleMode=true contains 'Simple Mode (ON)'", () => {
    const result = plannerPrompt(true);
    expect(result).toContain("Simple Mode (ON)");
  });

  it("with simpleMode=false does NOT contain 'Simple Mode'", () => {
    const result = plannerPrompt(false);
    expect(result).not.toContain("Simple Mode");
  });

  it("with simpleMode undefined does NOT contain 'Simple Mode'", () => {
    const result = plannerPrompt();
    expect(result).not.toContain("Simple Mode");
  });

  it("with language='ja' contains Japanese instruction", () => {
    const result = plannerPrompt(false, "ja");
    expect(result).toContain("Always respond in Japanese.");
  });

  it("with language='en' contains English instruction", () => {
    const result = plannerPrompt(false, "en");
    expect(result).toContain("Always respond in English.");
  });

  it("with language='fr' (unsupported) does not add language instruction", () => {
    const result = plannerPrompt(false, "fr");
    expect(result).not.toContain("Always respond in");
    // Should still be a valid prompt
    expect(result).toContain("senior software architect");
  });

  it("with language undefined does not add language instruction", () => {
    const result = plannerPrompt(false);
    expect(result).not.toContain("Always respond in");
  });

  it("combines simpleMode and language correctly", () => {
    const result = plannerPrompt(true, "ja");
    expect(result).toContain("Simple Mode (ON)");
    expect(result).toContain("Always respond in Japanese.");
  });

  it("contains plan format with summary/architecture/dataModel/tasks", () => {
    const result = plannerPrompt();
    expect(result).toContain("summary");
    expect(result).toContain("architecture");
    expect(result).toContain("dataModel");
    expect(result).toContain("tasks");
  });

  it("contains Layout Planning section", () => {
    const result = plannerPrompt();
    expect(result).toContain("Layout Planning");
  });

  it("mentions read-only restriction", () => {
    const result = plannerPrompt();
    expect(result).toContain("CANNOT modify files");
  });
});
