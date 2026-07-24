import * as React from "react";
import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { viewportClassName?: string }
>(({ className, children, viewportClassName, onScroll, ...props }, ref) => {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const combinedRef = (el: HTMLDivElement | null) => {
    // Forward to both refs
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };

  // Attach scroll listener to the viewport div
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !onScroll) return;
    const handler = onScroll as React.EventHandler<any>;
    viewport.addEventListener("scroll", handler, { passive: true });
    return () => viewport.removeEventListener("scroll", handler);
  }, [onScroll]);

  return (
    <div ref={combinedRef} className={cn("relative overflow-hidden", className)} {...props}>
      <div
        ref={viewportRef}
        className={cn("w-full h-full overflow-auto", viewportClassName)}
      >
        {children}
      </div>
    </div>
  );
});
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
