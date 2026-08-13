export const languages = [
  {
    code: "ja",
    labelKey: "languages.ja",
    nativeName: "日本語",
    countryCode: "jp",
    subtitle: "おかえりなさい。",
  },
  {
    code: "en",
    labelKey: "languages.en",
    nativeName: "English",
    countryCode: "us",
    subtitle: "This is the way.",
  },
] as const;

export type LanguageCode = (typeof languages)[number]["code"];

/**
 * Multi-language "choose your language" phrases that cycle on the selection screen.
 */
export const languageSelectPhrases = [
  "Choose your language",
  "言語を選択してください",
] as const;

/**
 * Multi-language "you can change it later" subtitles that cycle together
 * with languageSelectPhrases (same index).
 */
export const languageSelectSubtitles = [
  "You can change it later. It's easier than life choices.",
  "後で変えられます。人生の選択より気楽です。",
] as const;
