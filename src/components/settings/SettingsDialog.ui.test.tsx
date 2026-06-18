import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "settings.title": "Settings",
        "settings.description": "Customize your app settings",
        "settings.theme": "Theme",
        "settings.themeLight": "Light",
        "settings.themeDark": "Dark",
        "settings.themeSystem": "System",
        "settings.simpleMode": "Simple Mode",
        "settings.simpleModeDescription": "Simplified UI for non-engineers",
        "settings.language": "Language",
      };
      return translations[key] ?? key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// Mock Zustand store
const updateSettings = vi.fn();

const mockSettings = {
  theme: "system" as "light" | "dark" | "system",
  uiFontSize: 14,
  codeFontSize: 13,
  language: "ja",
  simpleMode: true,
};

const mockStore = {
  settings: mockSettings,
  updateSettings,
};

vi.mock("@/store/useAppStore", () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

// Mock lucide-react icons (rendered as empty spans)
vi.mock("lucide-react", () => {
  const createIcon = (name: string) => () => <span data-testid={`icon-${name}`} />;
  return {
    Sun: createIcon("sun"),
    Moon: createIcon("moon"),
    Monitor: createIcon("monitor"),
    Globe: createIcon("globe"),
    List: createIcon("list"),
    ChevronRight: createIcon("chevron-right"),
  };
});

describe("SettingsDialog", () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockSettings, {
      theme: "system" as "light" | "dark" | "system",
      uiFontSize: 14,
      codeFontSize: 13,
      language: "ja",
      simpleMode: true,
    });
  });

  it("renders settings dialog when open", () => {
    render(<SettingsDialog open={true} onOpenChange={onOpenChange} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Customize your app settings")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<SettingsDialog open={false} onOpenChange={onOpenChange} />);
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("contains theme options", () => {
    render(<SettingsDialog open={true} onOpenChange={onOpenChange} />);
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("calls updateSettings when a theme option is clicked", () => {
    render(<SettingsDialog open={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByText("Light"));
    expect(updateSettings).toHaveBeenCalledWith({ theme: "light" });
  });

  it("highlights the active theme option", () => {
    mockSettings.theme = "dark";
    render(<SettingsDialog open={true} onOpenChange={onOpenChange} />);
    // The active button should have the primary class indicator
    const darkButton = screen.getByText("Dark").closest("button");
    expect(darkButton?.className).toContain("border-primary");
  });

  it("contains simple mode options", () => {
    render(<SettingsDialog open={true} onOpenChange={onOpenChange} />);
    expect(screen.getByText("Simple Mode")).toBeInTheDocument();
    expect(screen.getByText("ON")).toBeInTheDocument();
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });

  it("contains language option", () => {
    render(<SettingsDialog open={true} onOpenChange={onOpenChange} />);
    expect(screen.getByText("Language")).toBeInTheDocument();
  });
});
