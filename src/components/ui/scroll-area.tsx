import * as React from "react";
import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { viewportClassName?: string }
>(({ className, children, viewportClassName, ...props }, ref) => (
  <div ref={ref} className={cn("relative overflow-hidden", className)} {...props}>
    <div className={cn("h-full w-full overflow-auto", viewportClassName)}>
      {children}
    </div>
  </div>
));
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
