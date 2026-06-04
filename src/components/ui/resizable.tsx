import * as React from "react";
import {
  Group,
  Panel,
  Separator,
} from "react-resizable-panels";
import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({
  className,
  direction = "horizontal",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  direction?: "horizontal" | "vertical";
}) => {
  // Filter out children that are visually hidden via className so the library
  // doesn't try to lay them out.  This is a safety net — callers should prefer
  // conditional rendering over CSS-based hiding.
  const visibleChildren = React.Children.toArray(children).filter((child) => {
    if (React.isValidElement(child)) {
      const cls = child.props.className ?? "";
      if (cls.split(" ").includes("hidden")) return false;
    }
    return true;
  });

  return (
    <Group
      orientation={direction}
      className={cn("h-full w-full", className)}
      {...props}
    >
      {visibleChildren}
    </Group>
  );
};

const ResizablePanel = ({
  className,
  style,
  defaultSize,
  minSize,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  defaultSize?: number | string;
  minSize?: number | string;
}) => {
  // Coerce numeric values to percentage strings (the library accepts "50%")
  const toPercent = (v: number | string | undefined) =>
    v === undefined ? undefined : typeof v === "number" ? `${v}%` : v;

  return (
    <Panel
      defaultSize={toPercent(defaultSize)}
      minSize={toPercent(minSize)}
      className={cn("overflow-auto", className)}
      style={style}
      {...props}
    >
      {children}
    </Panel>
  );
};

const ResizableHandle = ({
  className,
  direction = "horizontal",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  direction?: "horizontal" | "vertical";
}) => (
  <Separator
    className={cn(
      "relative flex items-center justify-center bg-border transition-colors",
      "data-[separator=active]:bg-primary/50",
      "data-[separator=focus]:bg-primary/50",
      direction === "horizontal"
        ? "w-1 cursor-col-resize"
        : "h-1 cursor-row-resize",
      className,
    )}
    {...props}
  >
    {children ?? (
      <div
        className={cn(
          "rounded-full bg-border",
          direction === "horizontal" ? "h-8 w-0.5" : "w-8 h-0.5",
        )}
      />
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
