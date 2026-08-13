import { describe, it, expect } from "vitest";
import { plannerPrompt, coderPrompt, verifierPrompt, visualQAPrompt } from "./index";

describe("system prompts barrel export", () => {
  it("re-exports plannerPrompt", () => {
    expect(plannerPrompt).toBeDefined();
    expect(typeof plannerPrompt).toBe("function");
    const result = plannerPrompt();
    expect(result).toContain("senior software architect");
  });

  it("re-exports coderPrompt", () => {
    expect(coderPrompt).toBeDefined();
    expect(typeof coderPrompt).toBe("function");
    const result = coderPrompt();
    expect(result).toContain("React/TypeScript");
  });

  it("re-exports verifierPrompt", () => {
    expect(verifierPrompt).toBeDefined();
    expect(typeof verifierPrompt).toBe("function");
    const result = verifierPrompt();
    expect(result).toContain("QA engineer");
  });

  it("re-exports visualQAPrompt", () => {
    expect(visualQAPrompt).toBeDefined();
    expect(typeof visualQAPrompt).toBe("function");
    const result = visualQAPrompt();
    expect(result).toContain("visual QA engineer");
  });

  it("all four exports are distinct functions", () => {
    expect(plannerPrompt).not.toBe(coderPrompt);
    expect(plannerPrompt).not.toBe(verifierPrompt);
    expect(plannerPrompt).not.toBe(visualQAPrompt);
    expect(coderPrompt).not.toBe(verifierPrompt);
    expect(coderPrompt).not.toBe(visualQAPrompt);
    expect(verifierPrompt).not.toBe(visualQAPrompt);
  });
});
