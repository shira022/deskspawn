import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./input";

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input />);
    const input = screen.getByRole("textbox");
    expect(input.tagName).toBe("INPUT");
  });

  it("forwards ref to input element", () => {
    let ref: HTMLInputElement | null = null;
    render(<Input ref={(el: HTMLInputElement | null) => { ref = el; }} />);
    expect(ref).not.toBeNull();
    expect(ref!.tagName).toBe("INPUT");
  });

  it("applies custom className", () => {
    render(<Input className="my-class" />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("my-class");
  });

  it("supports disabled state", () => {
    render(<Input disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("supports placeholder", () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
  });

  it("supports type attribute", () => {
    render(<Input type="email" />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("type", "email");
  });
});
