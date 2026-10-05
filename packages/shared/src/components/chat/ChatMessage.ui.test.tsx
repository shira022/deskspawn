import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import type { ChatMessage as ChatMessageType } from "../../types";

const COST_UNKNOWN = "Cost unknown (model pricing unavailable)";

// Pin the locale the component formats costs with. `toLocaleString(undefined)`
// uses the runtime's default locale, which is environment-dependent (e.g. a
// de-DE CI box would render "$0,005734") — force en-US so the expectations are
// deterministic instead of flaky.
const nativeToLocaleString = Number.prototype.toLocaleString;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "chat.costUnknown": COST_UNKNOWN,
      };
      return translations[key] ?? key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

const mockStore = {
  editingMessageId: null as string | null,
  agentStatus: "idle" as string,
};

vi.mock("../../store/useAppStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
    { getState: () => mockStore },
  ),
}));

function assistantMessage(estimatedCost: number | null | undefined): ChatMessageType {
  return {
    id: "msg-1",
    role: "assistant",
    content: "Hello",
    timestamp: Date.now(),
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4o",
      estimatedCost: estimatedCost as number | undefined,
    },
  };
}

describe("ChatMessage cost display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (
      this: number,
      locales?: Intl.LocalesArgument,
      options?: Intl.NumberFormatOptions,
    ) {
      return nativeToLocaleString.call(this, locales ?? "en-US", options);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows '-' with a costUnknown tooltip when estimatedCost is undefined", () => {
    render(<ChatMessage message={assistantMessage(undefined)} />);

    const unknown = screen.getByTitle(COST_UNKNOWN);
    expect(unknown).toHaveTextContent("-");
    expect(unknown).not.toHaveTextContent("$");
  });

  it("shows '-' with a costUnknown tooltip when estimatedCost is null (legacy)", () => {
    render(<ChatMessage message={assistantMessage(null)} />);

    const unknown = screen.getByTitle(COST_UNKNOWN);
    expect(unknown).toHaveTextContent("-");
    expect(unknown).not.toHaveTextContent("$");
  });

  it("shows the formatted dollar amount when estimatedCost is a known number", () => {
    render(<ChatMessage message={assistantMessage(0.005734)} />);

    expect(screen.getByText("$0.005734")).toBeInTheDocument();
    expect(screen.queryByTitle(COST_UNKNOWN)).not.toBeInTheDocument();
  });

  it("shows '$0.0000' (not '-') when pricing is known and the cost is zero", () => {
    render(<ChatMessage message={assistantMessage(0)} />);

    expect(screen.getByText("$0.0000")).toBeInTheDocument();
    expect(screen.queryByTitle(COST_UNKNOWN)).not.toBeInTheDocument();
  });
});
