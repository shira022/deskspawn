import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

function Tabs({ defaultValue, value, onValueChange, className, children }: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const currentValue = value ?? internalValue;
  const setValue = onValueChange ?? setInternalValue;

  return (
    <div className={cn("w-full", className)} data-value={currentValue}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            currentValue,
            setValue,
          });
        }
        return child;
      })}
    </div>
  );
}

function TabsList({
  className,
  children,
  currentValue,
  setValue,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  currentValue?: string;
  setValue?: (v: string) => void;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    >
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            currentValue,
            setValue,
          });
        }
        return child;
      })}
    </div>
  );
}

function TabsTrigger({
  className,
  value,
  currentValue,
  setValue,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
  currentValue?: string;
  setValue?: (v: string) => void;
}) {
  const isActive = currentValue === value;
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        isActive && "bg-background text-foreground shadow",
        className
      )}
      onClick={() => setValue?.(value)}
      {...props}
    >
      {children}
    </button>
  );
}

function TabsContent({
  className,
  value,
  currentValue,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value: string;
  currentValue?: string;
}) {
  if (currentValue !== value) return null;
  return (
    <div className={cn("mt-2", className)} {...props}>
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
