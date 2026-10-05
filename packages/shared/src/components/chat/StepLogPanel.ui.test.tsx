import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepLogPanel } from "./StepLogPanel";
import type { StepLogEntry } from "../../types";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "step.executionLog": "Execution log",
        "step.liveLog": "Live log",
        "step.stepsCount": "{{count}} steps",
        "step.runningBadge": "running",
        "step.errorsBadge": "errors",
        "step.running": "Running",
        "step.success": "Success",
        "step.error": "Error",
        "step.args": "Args",
        "step.result": "Result",
        "step.executing": "Executing...",
        "step.readFile": "Read file",
        "step.listFiles": "List files",
        "step.applyArtifact": "Apply artifact",
        "step.runShell": "Run shell",
        "step.getErrors": "Get errors",
        "step.takeScreenshot": "Take screenshot",
      };
      let text = translations[key] ?? key;
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

// Mock Zustand store — increment/decrement also update a shared counter so the
// panel's sync logic can be asserted on the resulting value, not just call counts.
const counterState = { logPanelOpenCount: 0 };
const mockStore = {
  incrementLogPanelOpen: vi.fn(() => {
    counterState.logPanelOpenCount += 1;
  }),
  decrementLogPanelOpen: vi.fn(() => {
    counterState.logPanelOpenCount -= 1;
  }),
};

vi.mock("../../store/useAppStore", () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

const stepLogs: StepLogEntry[] = [
  {
    step: 1,
    toolName: "read_file",
    args: { path: "src/main.ts" },
    result: "file contents",
    status: "success",
  },
  {
    step: 2,
    toolName: "apply_artifact",
    args: { id: "artifact-1" },
    status: "success",
  },
];

const getToggle = () => screen.getByRole("button", { name: /Execution log/ });
const openPanel = () => fireEvent.click(getToggle());

describe("StepLogPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    counterState.logPanelOpenCount = 0;
  });

  it("renders the collapsed panel header with the step count", () => {
    render(<StepLogPanel stepLogs={stepLogs} />);
    expect(getToggle()).toBeInTheDocument();
    expect(screen.getByText("2 steps")).toBeInTheDocument();
  });

  it("shows step rows when expanded", () => {
    render(<StepLogPanel stepLogs={stepLogs} />);
    expect(screen.queryByText("Step 1")).not.toBeInTheDocument();
    openPanel();
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
  });

  it("does not touch the store counter while collapsed", () => {
    render(<StepLogPanel stepLogs={stepLogs} />);
    expect(counterState.logPanelOpenCount).toBe(0);
    expect(mockStore.incrementLogPanelOpen).not.toHaveBeenCalled();
    expect(mockStore.decrementLogPanelOpen).not.toHaveBeenCalled();
  });

  it("increments the store counter when expanded", () => {
    render(<StepLogPanel stepLogs={stepLogs} />);
    openPanel();
    expect(mockStore.incrementLogPanelOpen).toHaveBeenCalledTimes(1);
    expect(counterState.logPanelOpenCount).toBe(1);
  });

  it("decrements the store counter when collapsed again", () => {
    render(<StepLogPanel stepLogs={stepLogs} />);
    openPanel();
    fireEvent.click(getToggle());
    expect(mockStore.incrementLogPanelOpen).toHaveBeenCalledTimes(1);
    expect(mockStore.decrementLogPanelOpen).toHaveBeenCalledTimes(1);
    expect(counterState.logPanelOpenCount).toBe(0);
  });

  it("decrements the store counter exactly once when unmounted while expanded", () => {
    const { unmount } = render(<StepLogPanel stepLogs={stepLogs} />);
    openPanel();
    expect(counterState.logPanelOpenCount).toBe(1);
    unmount();
    expect(mockStore.incrementLogPanelOpen).toHaveBeenCalledTimes(1);
    expect(mockStore.decrementLogPanelOpen).toHaveBeenCalledTimes(1);
    expect(counterState.logPanelOpenCount).toBe(0);
  });

  it("does not decrement when unmounted while collapsed", () => {
    const { unmount } = render(<StepLogPanel stepLogs={stepLogs} />);
    unmount();
    expect(mockStore.decrementLogPanelOpen).not.toHaveBeenCalled();
    expect(counterState.logPanelOpenCount).toBe(0);
  });
});
