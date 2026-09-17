import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentTierSelector } from "./AgentTierSelector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "chat.agentTier.label": "Agent setup",
        "chat.agentTier.auto": "Auto",
        "chat.agentTier.level": "L{{level}}",
        "chat.agentTier.autoScale": "Auto (scale: L{{level}})",
        "chat.agentTier.autoScaleIdle": "Auto (not yet analyzed)",
        "chat.agentTier.manualScale": "Manual: L{{level}}",
        "chat.agentTier.descAuto": "Automatic (triage)",
        "chat.agentTier.desc1": "Coder only (single shot)",
        "chat.agentTier.desc2": "Coder + verifier (no planner)",
        "chat.agentTier.desc3": "Planner + coder + verifier",
        "chat.agentTier.desc4": "+ Visual QA (1 fix round, dummy-data regen)",
        "chat.agentTier.desc5": "Full + 2 fix rounds, dummy-data regen",
      };
      let text = map[key] ?? key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          text = text.replace(`{{${k}}}`, String(v));
        }
      }
      return text;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

const mockStore = {
  agentTier: "auto" as string,
  setAgentTier: vi.fn(),
  lastTriage: null as { level: number; source: string; reason?: string } | null,
  setLastTriage: vi.fn(),
};

vi.mock("../../store/useAppStore", () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

describe("AgentTierSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.agentTier = "auto";
    mockStore.lastTriage = null;
  });

  it("defaults to Auto", () => {
    render(<AgentTierSelector />);
    expect(screen.getByRole("button", { name: "Agent setup" })).toHaveTextContent("Auto");
  });

  it("shows Auto + L1..L5 options when opened", () => {
    render(<AgentTierSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Agent setup" }));
    expect(screen.getAllByRole("option")).toHaveLength(6);
    for (const label of ["Auto", "L1", "L2", "L3", "L4", "L5"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("shows a description for every option", () => {
    render(<AgentTierSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Agent setup" }));
    const expected: Record<string, string> = {
      Auto: "Automatic (triage)",
      L1: "Coder only (single shot)",
      L2: "Coder + verifier (no planner)",
      L3: "Planner + coder + verifier",
      L4: "+ Visual QA (1 fix round, dummy-data regen)",
      L5: "Full + 2 fix rounds, dummy-data regen",
    };
    for (const [label, desc] of Object.entries(expected)) {
      expect(screen.getByRole("option", { name: label })).toHaveTextContent(desc);
    }
  });

  it("keeps the accessible names as Auto and L1..L5", () => {
    render(<AgentTierSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Agent setup" }));
    for (const label of ["Auto", "L1", "L2", "L3", "L4", "L5"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("includes the current level and description in the trigger title", () => {
    mockStore.agentTier = "L3";
    render(<AgentTierSelector />);
    expect(screen.getByRole("button", { name: "Agent setup" })).toHaveAttribute(
      "title",
      "L3 — Planner + coder + verifier"
    );
  });

  it("includes the auto description in the trigger title", () => {
    mockStore.agentTier = "auto";
    render(<AgentTierSelector />);
    expect(screen.getByRole("button", { name: "Agent setup" })).toHaveAttribute(
      "title",
      "Auto — Automatic (triage)"
    );
  });

  it("updates the store and closes when a level is selected", () => {
    render(<AgentTierSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Agent setup" }));
    fireEvent.click(screen.getByRole("option", { name: "L3" }));
    expect(mockStore.setAgentTier).toHaveBeenCalledWith("L3");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("shows the auto scale when a triage result exists", () => {
    mockStore.agentTier = "auto";
    mockStore.lastTriage = { level: 3, source: "auto" };
    render(<AgentTierSelector />);
    expect(screen.getByTestId("agent-scale")).toHaveTextContent("Auto (scale: L3)");
  });

  it("shows the idle auto label when the last triage came from a manual run", () => {
    // 手動実行の結果 (source: "manual") はオートの規模表示に使わない
    mockStore.agentTier = "auto";
    mockStore.lastTriage = { level: 4, source: "manual" };
    render(<AgentTierSelector />);
    expect(screen.getByTestId("agent-scale")).toHaveTextContent("Auto (not yet analyzed)");
    expect(screen.getByTestId("agent-scale")).not.toHaveTextContent("Auto (scale: L4)");
  });

  it("shows an idle auto label before any triage result", () => {
    mockStore.agentTier = "auto";
    mockStore.lastTriage = null;
    render(<AgentTierSelector />);
    expect(screen.getByTestId("agent-scale")).toHaveTextContent("Auto (not yet analyzed)");
  });

  it("shows the manual label when a level is selected", () => {
    mockStore.agentTier = "L4";
    mockStore.lastTriage = null;
    render(<AgentTierSelector />);
    expect(screen.getByTestId("agent-scale")).toHaveTextContent("Manual: L4");
    expect(screen.getByRole("button", { name: "Agent setup" })).toHaveTextContent("L4");
  });

  it("closes on Escape", () => {
    render(<AgentTierSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Agent setup" }));
    expect(screen.getAllByRole("option")).toHaveLength(6);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
