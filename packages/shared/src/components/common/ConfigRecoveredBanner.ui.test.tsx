import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfigRecoveredBanner } from "./ConfigRecoveredBanner";

const enModules = import.meta.glob("../../locales/en/common.json", {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const enBundle = Object.values(enModules)[0]?.default ?? {};

function lookup(bundle: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, bundle);
}

function enT(key: string): string {
  const value = lookup(enBundle, key);
  return typeof value === "string" ? value : key;
}

vi.mock("react-i18next", async () => {
  const modules = import.meta.glob("../../locales/en/common.json", {
    eager: true,
  }) as Record<string, { default: Record<string, unknown> }>;
  const bundle = Object.values(modules)[0]?.default ?? {};

  const t = (key: string): string => {
    const value = lookup(bundle, key);
    return typeof value === "string" ? value : key;
  };

  return {
    useTranslation: () => ({ t, i18n: { changeLanguage: vi.fn(), language: "en" } }),
    initReactI18next: { type: "3rdParty", init: () => undefined },
  };
});

const mockStore = vi.hoisted(() => ({
  configRecovered: false,
}));

vi.mock("../../store/useAppStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) =>
    selector ? selector(mockStore) : mockStore,
}));

beforeEach(() => {
  mockStore.configRecovered = false;
});

describe("ConfigRecoveredBanner", () => {
  it("shows the recovery message when configRecovered is true", () => {
    mockStore.configRecovered = true;

    render(<ConfigRecoveredBanner />);

    expect(screen.getByText(enT("chat.error.configRecoveredBanner"))).toBeInTheDocument();
  });

  it("renders above full-screen overlays with a z-[10000] class", () => {
    mockStore.configRecovered = true;

    const { container } = render(<ConfigRecoveredBanner />);

    expect(container.firstElementChild).toHaveClass("z-[10000]");
  });

  it("renders nothing when configRecovered is false", () => {
    mockStore.configRecovered = false;

    const { container } = render(<ConfigRecoveredBanner />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(enT("chat.error.configRecoveredBanner"))).toBeNull();
  });
});
