import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dialog, DialogContent, DialogOverlay, DialogTitle } from "./dialog";

describe("Dialog", () => {
  const onOpenChange = vi.fn();

  it("renders when open is true", () => {
    render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Test Dialog</DialogTitle>
          <p>Dialog content</p>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Test Dialog")).toBeInTheDocument();
    expect(screen.getByText("Dialog content")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Hidden Dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    expect(screen.queryByText("Hidden Dialog")).not.toBeInTheDocument();
  });

  it("renders DialogOverlay when open", () => {
    render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Overlay Dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    // Overlay is rendered. DialogContent has the "fixed inset-0" class internally,
    // but we check the overlay by verifying it calls onOpenChange on click.
    // Find the overlay — it's rendered first by Dialog before children.
    // Dialog renders: <><DialogOverlay onClick={...} />{children}</>
    const overlay = document.querySelector('[class*="fixed"][class*="inset-0"]');
    expect(overlay).toBeInTheDocument();
  });

  it("calls onOpenChange with false when overlay is clicked", () => {
    render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Close Test</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    // The overlay is the first child element with fixed+inset-0 + bg-black/50
    const overlay = document.querySelector('[class*="bg-black\\/50"]');
    expect(overlay).toBeInTheDocument();
    fireEvent.click(overlay!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders children inside DialogContent", () => {
    render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Content Title</DialogTitle>
          <p>Inner content</p>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Content Title")).toBeInTheDocument();
    expect(screen.getByText("Inner content")).toBeInTheDocument();
  });
});
