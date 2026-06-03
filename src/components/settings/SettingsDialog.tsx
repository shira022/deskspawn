import { useAppStore } from "@/store/useAppStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sun, Moon, Monitor, Thermometer, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ThemeMode } from "@/types";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { t } = useTranslation();

  const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: t('settings.themeLight'), icon: <Sun className="h-3.5 w-3.5" /> },
    { value: "dark", label: t('settings.themeDark'), icon: <Moon className="h-3.5 w-3.5" /> },
    { value: "system", label: t('settings.themeSystem'), icon: <Monitor className="h-3.5 w-3.5" /> },
  ];

  const languageOptions = [
    { value: "ja", label: t('settings.langJa') },
    { value: "en", label: t('settings.langEn') },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogDescription>
            {t('settings.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* ── テーマ ── */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <Monitor className="h-3.5 w-3.5" />
              {t('settings.theme')}
            </label>
            <div className="flex gap-2">
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    updateSettings({ theme: opt.value });
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all ${
                    settings.theme === opt.value
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border/50 hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* ── デフォルト温度 ── */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <Thermometer className="h-3.5 w-3.5" />
              {t('settings.defaultTemperature')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={settings.defaultTemperature}
                onChange={(e) => updateSettings({ defaultTemperature: Number(e.target.value) })}
                className="flex-1 h-1.5 accent-primary"
              />
              <span className="text-xs tabular-nums w-10 text-right text-muted-foreground">
                {settings.defaultTemperature.toFixed(1)}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              {t('settings.temperatureHint')}
            </p>
          </div>

          <Separator />

          {/* ── 言語 ── */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <Globe className="h-3.5 w-3.5" />
              {t('settings.language')}
            </label>
            <Select
              value={settings.language}
              onChange={(e) => updateSettings({ language: e.target.value })}
              className="h-8 text-xs"
            >
              {languageOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
