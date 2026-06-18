import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Select } from "./select";

describe("Select", () => {
  it("renders a select element", () => {
    render(
      <Select>
        <option value="1">Option 1</option>
      </Select>
    );
    const select = screen.getByRole("combobox");
    expect(select.tagName).toBe("SELECT");
  });

  it("applies custom className", () => {
    render(
      <Select className="my-class">
        <option>Test</option>
      </Select>
    );
    const select = screen.getByRole("combobox");
    expect(select.className).toContain("my-class");
  });

  it("renders children (options)", () => {
    render(
      <Select>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("supports disabled state", () => {
    render(
      <Select disabled>
        <option>Test</option>
      </Select>
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("forwards ref to select element", () => {
    let ref: HTMLSelectElement | null = null;
    render(
      <Select ref={(el: HTMLSelectElement | null) => { ref = el; }}>
        <option>Test</option>
      </Select>
    );
    expect(ref).not.toBeNull();
    expect(ref!.tagName).toBe("SELECT");
  });
});
