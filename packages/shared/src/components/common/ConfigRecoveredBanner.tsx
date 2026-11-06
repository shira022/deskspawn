import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";

export function ConfigRecoveredBanner() {
  const configRecovered = useAppStore((s) => s.configRecovered);
  const { t } = useTranslation();

  if (!configRecovered) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 shadow dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {t("chat.error.configRecoveredBanner")}
      </div>
    </div>
  );
}
