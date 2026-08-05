import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class names into a single string", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes (falsy values are filtered)", () => {
    const result = cn("base", false && "hidden", true && "visible", undefined, null);
    expect(result).toBe("base visible");
  });

  it("handles arrays of classes", () => {
    const result = cn(["foo", "bar"], "baz");
    expect(result).toBe("foo bar baz");
  });

  it("handles nested arrays", () => {
    const result = cn(["foo", ["bar", "baz"]]);
    expect(result).toBe("foo bar baz");
  });

  it("handles object notation", () => {
    const result = cn({ foo: true, bar: false, baz: true });
    expect(result).toBe("foo baz");
  });

  it("resolves Tailwind conflicts (later wins)", () => {
    // twMerge should resolve the conflict: "px-4" wins over "px-2"
    const result = cn("px-2", "px-4");
    expect(result).toBe("px-4");
  });

  it("resolves conflicting utility classes", () => {
    const result = cn("text-red-500", "text-blue-700");
    expect(result).toBe("text-blue-700");
  });

  it("preserves non-conflicting classes", () => {
    const result = cn("flex", "items-center", "justify-between");
    expect(result).toBe("flex items-center justify-between");
  });

  it("handles undefined values", () => {
    expect(cn(undefined)).toBe("");
  });

  it("handles null values", () => {
    expect(cn(null)).toBe("");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });

  it("merges Tailwind margin classes correctly", () => {
    const result = cn("mt-4", "mt-6");
    expect(result).toBe("mt-6");
  });

  it("merges Tailwind padding with other classes", () => {
    const result = cn("p-4", "text-center", "p-6");
    expect(result).toBe("text-center p-6");
  });

  it("handles complex real-world usage", () => {
    const isActive = true;
    const hasError = false;
    const size = "lg";
    const result = cn(
      "btn",
      `btn-${size}`,
      isActive && "btn-active",
      hasError && "btn-error",
      "rounded-lg",
      "rounded-md", // conflict: rounded-md wins
    );
    expect(result).toBe("btn btn-lg btn-active rounded-md");
  });
});
