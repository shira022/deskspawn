import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatInput } from "./ChatInput";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "chat.aiGenerating": "AI is generating...",
        "chat.stop": "Stop",
        "chat.stopGenerating": "Stop generating",
        "chat.inputPlaceholder": "Type your message...",
        "chat.inputDisabledDuringGeneration": "Disabled during generation",
        "chat.sendTitle": "Send message",
      };
      return translations[key] ?? key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// Mock Zustand store
const mockStore = {
  agentStatus: "idle" as string,
  agentStepCount: 0,
  agentMaxSteps: 20,
};

vi.mock("@/store/useAppStore", () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

describe("ChatInput", () => {
  const onSend = vi.fn();
  const onStop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.agentStatus = "idle";
    mockStore.agentStepCount = 0;
    mockStore.agentMaxSteps = 20;
  });

  it("renders a textarea", () => {
    render(<ChatInput onSend={onSend} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows send button", () => {
    render(<ChatInput onSend={onSend} />);
    expect(screen.getByTitle("Send message")).toBeInTheDocument();
  });

  it("does not show stop button when agent is not running", () => {
    mockStore.agentStatus = "idle";
    render(<ChatInput onSend={onSend} onStop={onStop} />);
    expect(screen.queryByTitle("Stop generating")).not.toBeInTheDocument();
  });

  it("shows stop button when agent is running", () => {
    mockStore.agentStatus = "running";
    mockStore.agentStepCount = 3;
    render(<ChatInput onSend={onSend} onStop={onStop} />);
    expect(screen.getByTitle("Stop generating")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("disables textarea when agent is running", () => {
    mockStore.agentStatus = "running";
    render(<ChatInput onSend={onSend} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("disables textarea when disabled prop is true", () => {
    render(<ChatInput onSend={onSend} disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("disables send button when textarea is empty", () => {
    render(<ChatInput onSend={onSend} />);
    expect(screen.getByTitle("Send message")).toBeDisabled();
  });

  it("disables send button when agent is running", () => {
    mockStore.agentStatus = "running";
    render(<ChatInput onSend={onSend} />);
    expect(screen.getByTitle("Send message")).toBeDisabled();
  });

  it("shows placeholder text when idle", () => {
    mockStore.agentStatus = "idle";
    render(<ChatInput onSend={onSend} />);
    expect(screen.getByPlaceholderText("Type your message...")).toBeInTheDocument();
  });

  it("shows disabled placeholder when agent is running", () => {
    mockStore.agentStatus = "running";
    render(<ChatInput onSend={onSend} />);
    expect(screen.getByPlaceholderText("Disabled during generation")).toBeInTheDocument();
  });
});
