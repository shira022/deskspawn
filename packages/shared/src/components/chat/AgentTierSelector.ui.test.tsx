import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentTierSelector } from "./AgentTierSelector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "chat.agentTier.groupLabel": "Agent setup",
        "chat.agentTier.label.auto": "Auto",
        "chat.agentTier.label.t1": "Minimal",
        "chat.agentTier.label.t2": "Basic",
        "chat.agentTier.label.t3": "Standard",
        "chat.agentTier.label.t4": "Thorough",
        "chat.agentTier.label.t5": "Maximum",
        "chat.agentTier.hint.auto": "Picks a composition automatically",
        "chat.agentTier.hint.t1": "Build in one pass",
        "chat.agentTier.hint.t2": "Build then review",
        "chat.agentTier.hint.t3": "Plan, build, then review",
        "chat.agentTier.hint.t4": "Check the screen and fix",
        "chat.agentTier.hint.t5": "Keep fixing until polished",
        "chat.agentTier.agents.auto": "Detects complexity and picks the composition automatically",
        "chat.agentTier.agents.t1": "L1: coder",
        "chat.agentTier.agents.t2": "L2: coder + verifier",
        "chat.agentTier.agents.t3": "L3: planner + coder + verifier",
        "chat.agentTier.agents.t4": "L4: planner + coder + verifier + visual QA (1 fix round, dummy-data regen)",
        "chat.agentTier.agents.t5": "L5: full pipeline (up to 2 fix rounds, dummy-data regen)",
        "chat.agentTier.autoScale": "Auto: {{name}}",
        "chat.agentTier.autoScaleIdle": "Auto: not yet analyzed",
        "chat.agentTier.manualScale": "Manual: {{name}}",
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

const DISPLAY_NAMES = ["Auto", "Minimal", "Basic", "Standard", "Thorough", "Maximum"];
const HINTS: Record<string, string> = {
  Auto: "Picks a composition automatically",
  Minimal: "Build in one pass",
  Basic: "Build then review",
  Standard: "Plan, build, then review",
  Thorough: "Check the screen and fix",
  Maximum: "Keep fixing until polished",
};
const AGENTS: Record<string, string> = {
  Auto: "Detects complexity and picks the composition automatically",
  Minimal: "L1: coder",
  Basic: "L2: coder + verifier",
  Standard: "L3: planner + coder + verifier",
  Thorough:
    "L4: planner + coder + verifier + visual QA (1 fix round, dummy-data regen)",
  Maximum: "L5: full pipeline (up to 2 fix rounds, dummy-data regen)",
};

const openMenu = () =>
  fireEvent.click(screen.getByRole("button", { name: "Agent setup" }));

describe("AgentTierSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.agentTier = "auto";
    mockStore.lastTriage = null;
  });

  it("defaults to the Auto display name", () => {
    render(<AgentTierSelector />);
    expect(screen.getByRole("button", { name: "Agent setup" })).toHaveTextContent("Auto");
  });

  it("shows the six friendly display names when opened", () => {
    render(<AgentTierSelector />);
    openMenu();
    expect(screen.getAllByRole("option")).toHaveLength(6);
    for (const label of DISPLAY_NAMES) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("does not leak technical level terms (L1/L2/...) into the rows", () => {
    render(<AgentTierSelector />);
    openMenu();
    for (const tier of ["1", "2", "3", "4", "5"]) {
      expect(screen.queryByRole("option", { name: `L${tier}` })).not.toBeInTheDocument();
    }
  });

  it("shows a one-line hint for every option", () => {
    render(<AgentTierSelector />);
    openMenu();
    for (const [label, hint] of Object.entries(HINTS)) {
      expect(screen.getByRole("option", { name: label })).toHaveTextContent(hint);
    }
  });

  it("keeps the accessible names as the friendly display names", () => {
    render(<AgentTierSelector />);
    openMenu();
    for (const label of DISPLAY_NAMES) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("tags the trigger and each option with a stable data-tier value", () => {
    render(<AgentTierSelector />);
    const trigger = screen.getByRole("button", { name: "Agent setup" });
    expect(trigger).toHaveAttribute("data-tier", "auto");
    openMenu();
    const expected = ["auto", "1", "2", "3", "4", "5"];
    DISPLAY_NAMES.forEach((label, i) => {
      expect(screen.getByRole("option", { name: label })).toHaveAttribute(
        "data-tier",
        expected[i]
      );
    });
  });

  it("shows the current composition tooltip when hovering the pill", () => {
    render(<AgentTierSelector />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Agent setup" }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(AGENTS.Auto);
    expect(tooltip).toHaveAttribute("data-tier", "auto");
    expect(tooltip.closest("[data-tooltip-anchor]")).toBeNull();
  });

  it("previews a candidate composition while hovering that option", () => {
    render(<AgentTierSelector />);
    openMenu();
    fireEvent.mouseEnter(screen.getByRole("option", { name: "Basic" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(AGENTS.Basic);
    expect(screen.getByRole("tooltip")).toHaveAttribute("data-tier", "2");
  });

  it("anchors the tooltip inside the hovered row when the dropdown is open", () => {
    render(<AgentTierSelector />);
    openMenu();
    fireEvent.mouseEnter(screen.getByRole("option", { name: "Thorough" }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(AGENTS.Thorough);
    expect(tooltip.closest('[data-tooltip-anchor="4"]')).not.toBeNull();
  });

  it("follows keyboard focus to a candidate composition", () => {
    render(<AgentTierSelector />);
    openMenu();
    fireEvent.focus(screen.getByRole("option", { name: "Thorough" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(AGENTS.Thorough);
  });

  it("hides the tooltip on mouse leave", () => {
    render(<AgentTierSelector />);
    const trigger = screen.getByRole("button", { name: "Agent setup" });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("links the trigger to the tooltip with aria-describedby while visible", () => {
    render(<AgentTierSelector />);
    const trigger = screen.getByRole("button", { name: "Agent setup" });
    expect(trigger).not.toHaveAttribute("aria-describedby");
    fireEvent.mouseEnter(trigger);
    const tooltip = screen.getByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
  });

  it("does not use a native title on the trigger", () => {
    render(<AgentTierSelector />);
    expect(screen.getByRole("button", { name: "Agent setup" })).not.toHaveAttribute("title");
  });

  it("updates the store with the internal value and closes on select", () => {
    render(<AgentTierSelector />);
    openMenu();
    fireEvent.click(screen.getByRole("option", { name: "Standard" }));
    expect(mockStore.setAgentTier).toHaveBeenCalledWith("L3");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("shows the analyzed scale with a display name", () => {
    mockStore.agentTier = "auto";
    mockStore.lastTriage = { level: 3, source: "auto" };
    render(<AgentTierSelector />);
    expect(screen.getByTestId("agent-scale")).toHaveTextContent("Auto: Standard");
  });

  it("shows the idle label when the last triage came from a manual run", () => {
    // 手動実行の結果 (source: "manual") はオートの判定表示に使わない
    mockStore.agentTier = "auto";
    mockStore.lastTriage = { level: 4, source: "manual" };
    render(<AgentTierSelector />);
    expect(screen.getByTestId("agent-scale")).toHaveTextContent("Auto: not yet analyzed");
    expect(screen.getByTestId("agent-scale")).not.toHaveTextContent("Auto: Thorough");
  });

  it("shows an idle label before any triage result", () => {
    mockStore.agentTier = "auto";
    mockStore.lastTriage = null;
    render(<AgentTierSelector />);
    expect(screen.getByTestId("agent-scale")).toHaveTextContent("Auto: not yet analyzed");
  });

  it("shows the manual label with the display name when a level is selected", () => {
    mockStore.agentTier = "L4";
    mockStore.lastTriage = null;
    render(<AgentTierSelector />);
    expect(screen.getByTestId("agent-scale")).toHaveTextContent("Manual: Thorough");
    expect(screen.getByRole("button", { name: "Agent setup" })).toHaveTextContent("Thorough");
  });

  it("closes on Escape", () => {
    render(<AgentTierSelector />);
    openMenu();
    expect(screen.getAllByRole("option")).toHaveLength(6);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("closes on outside click", () => {
    render(<AgentTierSelector />);
    openMenu();
    expect(screen.getAllByRole("option")).toHaveLength(6);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
