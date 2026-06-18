/**
 * Language Selection Screen — DeskSpawn Boot
 *
 * Full-screen playful language picker shown on first visit.
 * Displays language buttons with a humorous, lighthearted design.
 */

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { languages, languageSelectPhrases } from "@/lib/languages";
import { Globe, X } from "lucide-react";

interface Props {
  onSelect: (code: string) => void;
  /** When provided, shows a close button and reuses the screen as an overlay (e.g. from settings) */
  onClose?: () => void;
}

export function LanguageSelectScreen({ onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [introIdx, setIntroIdx] = useState(0);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  const intros = useMemo(
    () => languages.flatMap((l) => l.intros).sort(() => Math.random() - 0.5),
    [],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Upper line: multi-language title cycling at 3000ms
  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % languageSelectPhrases.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Lower line: homage rotation at 6700ms, random (avoid repeats)
  useEffect(() => {
    const interval = setInterval(() => {
      setIntroIdx((i) => {
        let next: number;
        do {
          next = Math.floor(Math.random() * intros.length);
        } while (next === i && intros.length > 1);
        return next;
      });
    }, 6700);
    return () => clearInterval(interval);
  }, [intros.length]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background">
      {/* Close button (when used as overlay from settings) */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {/* Decorative background blobs */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/[0.02] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-primary/[0.04] blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.02] blur-3xl" />

      <div
        className={`
          relative z-10 flex flex-col items-center gap-8 px-4
          transition-all duration-700 ease-out
          ${mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}
        `}
      >
        {/* Globe icon with pulse ring */}
        <div className="relative">
          <div
            className="absolute inset-0 animate-ping rounded-full bg-primary/10 blur-md"
            style={{ animationDuration: "3s" }}
          />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/5">
            <Globe className="h-8 w-8 text-primary" />
          </div>
        </div>

        {/* Two-line text area */}
        <div className="flex flex-col items-center gap-0.5">
          {/* Upper line — multi-language title */}
          <div className="h-7 text-center">
            <span
              key={phraseIdx}
              className="text-base font-semibold transition-all duration-500"
            >
              {languageSelectPhrases[phraseIdx]}
            </span>
          </div>
          {/* Lower line — homage rotation */}
          <div className="h-5 text-center">
            <span
              key={introIdx}
              className="text-xs text-muted-foreground transition-all duration-500"
            >
              {intros[introIdx]}
            </span>
          </div>
        </div>

        {/* Language buttons */}
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
          {languages.map((lang) => {
            const isHovered = hoveredCode === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => onSelect(lang.code)}
                onMouseEnter={() => setHoveredCode(lang.code)}
                onMouseLeave={() => setHoveredCode(null)}
                className={`
                  group relative flex w-56 flex-col items-center gap-3
                  rounded-2xl border-2 bg-card px-8 py-10
                  shadow-sm outline-none
                  transition-all duration-300 ease-out
                  hover:shadow-lg hover:-translate-y-1 active:translate-y-0
                  ${
                    isHovered
                      ? "border-primary shadow-primary/10"
                      : "border-border"
                  }
                `}
              >
                {/* Flag */}
                <span
                  className={`
                    fi fi-${lang.countryCode} text-5xl transition-all duration-300
                    ${isHovered ? "scale-110 rotate-[8deg]" : ""}
                  `}
                ></span>

                {/* Language name */}
                <span className="text-xl font-bold">{lang.nativeName}</span>

                {/* Subtitle */}
                <span className="text-xs text-muted-foreground">
                  {lang.subtitle}
                </span>

                {/* Corner sparkle on hover */}
                {isHovered && (
                  <span className="absolute -top-3 -right-3 text-lg animate-bounce">
                    ✨
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <p className="text-xs text-muted-foreground/40 transition-opacity duration-500 hover:opacity-100">
          {onClose ? t("languageSelect.footerClose") : t("languageSelect.footer")}
        </p>
      </div>
    </div>
  );
}
