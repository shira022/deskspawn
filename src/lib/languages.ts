export const languages = [
  {
    code: "ja",
    labelKey: "languages.ja",
    nativeName: "日本語",
    countryCode: "jp",
    intros: ["人生は選択肢だ。", "帰る場所があるって、いいよね。"],
    subtitle: "おかえりなさい。",
  },
  {
    code: "en",
    labelKey: "languages.en",
    nativeName: "English",
    countryCode: "us",
    intros: ["May the Force be with you.", "To infinity and beyond!"],
    subtitle: "This is the way.",
  },
] as const;

export type LanguageCode = (typeof languages)[number]["code"];

/** Multi-language "choose your language" phrases that cycle on the selection screen. */
export const languageSelectPhrases = [
  "Choose your language",
  "言語を選択してください",
] as const;
