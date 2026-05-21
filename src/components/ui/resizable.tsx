import * as React from "react";
import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({
  className,
  direction = "horizontal",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  direction?: "horizontal" | "vertical";
}) => (
  <div
    className={cn(
      "flex h-full w-full",
      direction === "horizontal" ? "flex-row" : "flex-col",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

const ResizablePanel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    defaultSize?: number;
    minSize?: number;
  }
>(({ className, style, defaultSize, minSize, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("overflow-auto", className)}
    style={{ flex: defaultSize ? `${defaultSize} 1 0%` : "1 1 0%", ...style }}
    {...props}
  />
));
ResizablePanel.displayName = "ResizablePanel";

const ResizableHandle = ({
  className,
  direction = "horizontal",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  direction?: "horizontal" | "vertical";
}) => (
  <div
    className={cn(
      "relative flex items-center justify-center bg-border",
      direction === "horizontal"
        ? "w-1 cursor-col-resize hover:bg-primary/50 transition-colors"
        : "h-1 cursor-row-resize hover:bg-primary/50 transition-colors",
      className
    )}
    {...props}
  >
    <div
      className={cn(
        "rounded-full bg-border",
        direction === "horizontal" ? "h-8 w-0.5" : "w-8 h-0.5"
      )}
    />
  </div>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
