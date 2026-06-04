import i18n from "i18next";
import { initReactI18next } from "react-i18next";

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

i18n.use(initReactI18next).init({
  resources,
  lng: "ja",
  fallbackLng: "ja",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
