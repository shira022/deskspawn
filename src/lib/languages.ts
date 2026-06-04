export const languages = [
  { code: "ja", labelKey: "languages.ja" },
  { code: "en", labelKey: "languages.en" },
] as const;

export type LanguageCode = (typeof languages)[number]["code"];
