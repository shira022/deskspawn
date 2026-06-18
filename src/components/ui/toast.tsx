import { useAppStore } from "@/store/useAppStore";
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const variantStyles = {
  success: "border-success/30 bg-success/10 text-foreground",
  error: "border-destructive/30 bg-destructive/10 text-foreground",
  warning: "border-warning/30 bg-warning/10 text-warning-foreground",
  info: "border-primary/20 bg-muted/80 text-foreground",
};

const variantIcons = {
  success: <CheckCircle2 className="h-4 w-4 text-success" />,
  error: <AlertCircle className="h-4 w-4 text-destructive" />,
  warning: <AlertTriangle className="h-4 w-4 text-warning" />,
  info: <Info className="h-4 w-4 text-primary" />,
};

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-lg",
            "animate-in slide-in-from-right-2 fade-in duration-200",
            variantStyles[toast.variant],
          )}
          style={{ minWidth: 260, maxWidth: 400 }}
        >
          <div className="mt-0.5 shrink-0">
            {variantIcons[toast.variant]}
          </div>
          <p className="text-xs leading-relaxed flex-1">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
