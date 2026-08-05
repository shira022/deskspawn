import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { SETTINGS_KEY } from "./constants";

const localeModules = import.meta.glob(
  "@/locales/*/common.json",
  { eager: true }
) as Record<string, { default: Record<string, unknown> }>;

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const [path, mod] of Object.entries(localeModules)) {
  const lang = path.match(/\/locales\/([^/]+)\/common\.json$/)?.[1];
  if (lang) {
    resources[lang] = { translation: mod.default };
  }
}

/** Read persisted language from settings storage, falling back to "ja". */
function getInitialLanguage(): string {
  const available = Object.keys(resources);
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.language === "string" && available.includes(s.language)) {
        return s.language;
      }
    }
  } catch {}
  return available.includes("ja") ? "ja" : available[0] ?? "ja";
}

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: "ja",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
