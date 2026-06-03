import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ja from "@/locales/ja/common.json";
import en from "@/locales/en/common.json";

export const resources = {
  ja: { translation: ja },
  en: { translation: en },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: "ja",
  fallbackLng: "ja",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
