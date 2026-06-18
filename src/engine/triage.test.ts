import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock "ai" module ───────────────────────────────────────────────────────────
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

// ── Imports (after vi.mock) ────────────────────────────────────────────────────

import { triageRequest } from "./triage";
import { generateText } from "ai";

// ── Helpers ────────────────────────────────────────────────────────────────────

const mockModel = {} as any;

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("triageRequest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls generateText with correct prompt parameters", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '{"mode": "single", "reason": "Simple fix"}',
    } as any);

    const messages = [{ role: "user", content: "Fix the button color" }];
    await triageRequest(messages, mockModel);

    expect(generateText).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(generateText).mock.calls[0][0];

    expect(callArgs.model).toBe(mockModel);
    expect(callArgs.system).toContain("request classifier");
    expect(callArgs.messages).toBeDefined();
    expect(callArgs.messages!).toHaveLength(1);
    expect(callArgs.messages![0].role).toBe("user");
    expect(callArgs.messages![0].content).toBe("Fix the button color");
    expect(callArgs.temperature).toBe(0.1);
    expect(callArgs.maxOutputTokens).toBe(100);
  });

  it('returns "simple" for a simple single-file fix request', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({ mode: "single", reason: "Simple fix, running in single mode" }),
    } as any);

    const result = await triageRequest(
      [{ role: "user", content: "Change button color to red" }],
      mockModel,
    );

    expect(result.mode).toBe("single");
    expect(result.reason).toContain("Simple");
  });

  it('returns "complex" for a multi-file feature request', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        mode: "multi",
        reason: "Multiple files needed, running multi-agent mode",
      }),
    } as any);

    const result = await triageRequest(
      [{ role: "user", content: "Create a full CRUD app with React and Express" }],
      mockModel,
    );

    expect(result.mode).toBe("multi");
    expect(result.reason).toContain("Multiple");
  });

  it("handles JSON response format with backtick code fence", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "```json\n{\"mode\": \"single\", \"reason\": \"Quick style change\"}\n```",
    } as any);

    const result = await triageRequest(
      [{ role: "user", content: "Change font size" }],
      mockModel,
    );

    expect(result.mode).toBe("single");
    expect(result.reason).toBe("Quick style change");
  });

  it("handles JSON without code fence but with extra text", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: 'Here is my analysis:\n{"mode": "multi", "reason": "Complex feature"}\nEnd.',
    } as any);

    const result = await triageRequest(
      [{ role: "user", content: "Build a dashboard" }],
      mockModel,
    );

    expect(result.mode).toBe("multi");
  });

  it("falls back to single when generateText returns unparseable text", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "I think this is a simple change",
    } as any);

    const result = await triageRequest(
      [{ role: "user", content: "Fix typo" }],
      mockModel,
    );

    expect(result.mode).toBe("single");
    expect(result.reason).toContain("Could not determine");
  });

  it("falls back to single when generateText throws", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("API error"));

    const result = await triageRequest(
      [{ role: "user", content: "Hello" }],
      mockModel,
    );

    expect(result.mode).toBe("single");
    expect(result.reason).toContain("Analysis error");
  });

  it("returns single when no user message is found", async () => {
    const result = await triageRequest(
      [{ role: "assistant", content: "Hello" }],
      mockModel,
    );

    expect(result.mode).toBe("single");
    expect(result.reason).toContain("No user message");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("extracts the last user message from a conversation", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({ mode: "single", reason: "Final fix" }),
    } as any);

    const messages = [
      { role: "user", content: "First message" },
      { role: "assistant", content: "OK" },
      { role: "user", content: "Fix the button finally" },
    ];

    await triageRequest(messages, mockModel);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Fix the button finally" }],
      }),
    );
  });

  it("handles empty content array in user message", async () => {
    const messages = [
      { role: "user", content: [] },
    ];

    const result = await triageRequest(messages, mockModel);

    expect(result.mode).toBe("single");
    expect(result.reason).toContain("No user message");
  });

  it("extracts text from multimodal content array", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({ mode: "single", reason: "Text fix" }),
    } as any);

    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Fix this paragraph" },
        ],
      },
    ];

    await triageRequest(messages, mockModel);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Fix this paragraph" }],
      }),
    );
  });
});
