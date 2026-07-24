import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Sun, Moon, Monitor, Globe, List, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { languages, type LanguageCode } from "@/lib/languages";
import type { ThemeMode } from "@/types";
import { LanguageSelectScreen } from "@/components/onboarding/LanguageSelectScreen";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { t } = useTranslation();
  const [showLanguageSelect, setShowLanguageSelect] = useState(false);

  const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: t('settings.themeLight'), icon: <Sun className="h-3.5 w-3.5" /> },
    { value: "dark", label: t('settings.themeDark'), icon: <Moon className="h-3.5 w-3.5" /> },
    { value: "system", label: t('settings.themeSystem'), icon: <Monitor className="h-3.5 w-3.5" /> },
  ];

  const currentLang = languages.find((l) => l.code === settings.language);
  const currentLangLabel = currentLang ? t(currentLang.labelKey) : settings.language;

  return (
    <>
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

          {/* ── シンプルモード ── */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <List className="h-3.5 w-3.5" />
              {t('settings.simpleMode')}
            </label>
            <p className="text-[10px] text-muted-foreground/50 mb-2">
              {t('settings.simpleModeDescription')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => updateSettings({ simpleMode: true })}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all ${
                  settings.simpleMode === true
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border/50 hover:bg-muted text-muted-foreground"
                }`}
              >
                ON
              </button>
              <button
                onClick={() => updateSettings({ simpleMode: false })}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all ${
                  settings.simpleMode === false
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border/50 hover:bg-muted text-muted-foreground"
                }`}
              >
                OFF
              </button>
            </div>
          </div>

          <Separator />

          {/* ── 言語 ── */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <Globe className="h-3.5 w-3.5" />
              {t('settings.language')}
            </label>
            <button
              onClick={() => setShowLanguageSelect(true)}
              className="w-full flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs hover:bg-muted transition-colors"
            >
              <span>
                <span className={`fi fi-${currentLang?.countryCode || ""} text-base align-middle`}></span>
                <span className="ml-1.5">{currentLangLabel}</span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Language selection overlay */}
    {showLanguageSelect && (
      <LanguageSelectScreen
        onSelect={(code) => {
          updateSettings({ language: code as LanguageCode });
          setShowLanguageSelect(false);
        }}
        onClose={() => setShowLanguageSelect(false)}
      />
    )}
  </>
  );
}
