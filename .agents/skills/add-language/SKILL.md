# add-language — Multi-Language Support Addition

> **Context Note**: This skill governs DeskSpawn (the tool) development — a React + TypeScript app with i18next-based internationalization. It details every file that must be modified when adding a new UI language.
>
> This skill is designed for AI agent or human execution. Follow the steps **in order**. Each step has a validation check.

## Purpose

Add a new display language to DeskSpawn by registering it in all required locations: language registry, UI translations, template strings, system prompts, and documentation.

## Trigger

- A request to add support for a new language (e.g. Korean, Chinese, French, German, Spanish)
- A new locale must be fully wired so users can select it, the UI renders in it, AI agents respond in it, and generated apps use it

## Pre-flight

1. Determine the target language's **ISO 639-1 code** (e.g. `ko`, `zh-CN`, `fr`, `de`, `es`)
2. Determine the language's **native name** (e.g. `한국어`, `中文`, `Français`, `Deutsch`, `Español`)
3. Determine the language's **country flag code** for `flag-icons` (e.g. `kr`, `cn`, `fr`, `de`, `es`)
4. Read the existing locale file at `src/locales/ja/common.json` as a reference for the full translation shape
5. Read `src/lib/languages.ts` to see the language registry format

## Step-by-Step Procedure

### Step 1 — Register the language in `src/lib/languages.ts`

Add a new entry to the `languages` array. The order determines button order on the language selection screen.

**File**: `src/lib/languages.ts`
**What to do**: Add an object to the `languages` array with these fields:
- `code` — ISO 639-1 language code (e.g. `"ko"`)
- `labelKey` — i18n key for the language's display name in the current UI language: `"languages.{code}"` (e.g. `"languages.ko"`)
- `nativeName` — Language name in the language itself (e.g. `"한국어"`)
- `countryCode` — Two-letter country code for `flag-icons` (e.g. `"kr"`)
- `intros` — Array of 2-3 fun/characterful phrases in the new language (shown in the language selection screen carousel)
- `subtitle` — A warm welcome phrase in the new language (e.g. `"어서 오세요"`)

```typescript
{
  code: "ko",
  labelKey: "languages.ko",
  nativeName: "한국어",
  countryCode: "kr",
  intros: ["길을 잃어도 괜찮아, 그것도 여행이야.", "시작이 반이다."],
  subtitle: "어서 오세요.",
},
```

> **Note**: The `LanguageCode` type at line 20 is auto-derived from this array via `(typeof languages)[number]["code"]`. No type update needed.

### Step 2 — Create the locale translation file

**Action**: Create `src/locales/{lang}/common.json` with all UI translations.

Use an existing locale file (e.g. `src/locales/en/common.json`) as a structural template. The JSON structure must be identical — same keys, same nesting depth. Only the string values change.

**Minimum required sections**:

```jsonc
{
  "languages": {
    "ja": "日本語",          // Language name in the new language
    "en": "English",          // Language name in the new language
    "{code}": "{nativeName}"  // Self-referencing entry
  },
  "languageSelect": {
    "footer": "You can change this later. No reboot required.",
    "footerClose": "Click ✕ to go back"
  },
  // ... all other sections from the reference locale file
}
```

> **Important**: The `languages.{code}` key is referenced by `labelKey` in `languages.ts` and displayed in the Settings dialog. Every locale file must have entries for ALL registered languages (so the Settings dialog can show each language's name in the current UI language).

### Step 3 — Add the language name to ALL existing locale files

Every existing locale JSON in `src/locales/*/common.json` needs the new language's name added to its `languages` section.

| File | Add |
|------|-----|
| `src/locales/ja/common.json` → `languages` | `"{code}": "{Japanese name for this language}"` |
| `src/locales/en/common.json` → `languages` | `"{code}": "{English name for this language}"` |

Example for Korean:
```jsonc
// src/locales/ja/common.json
"languages": {
  "ja": "日本語",
  "en": "English",
  "ko": "韓国語"       // ← add
},

// src/locales/en/common.json
"languages": {
  "ja": "日本語",
  "en": "English",
  "ko": "Korean"        // ← add
},
```

### Step 4 — Add template locale strings in `src/lib/template-locale.ts`

**File**: `src/lib/template-locale.ts`
**What to do**: Add a new entry to the `templateLocale` record with the language code as key.

The `TemplateLocale` interface has 8 fields:

| Field | Description | Example (Korean) |
|-------|-------------|-----------------|
| `appWaitingTitle` | Heading in generated App.tsx waiting state | `"앱 생성을 기다리는 중입니다"` |
| `appWaitingDescLine1` | First line of description | `"AI 채팅으로 앱 지시를 보내면,"` |
| `appWaitingDescLine2` | Second line of description | `"여기에 실시간 미리보기가 표시됩니다."` |
| `storeGuideComment` | Full comment block for store/index.ts (directory rules + pattern + example title) | See below |
| `storeReexportLabel` | Label above re-export placeholder in store/index.ts | `"여기에서 각 기능의 스토어를 다시 내보냅니다:"` |
| `hooksGuideComment` | Full comment block for hooks/index.ts | See below |
| `hooksReexportLabel` | Label above re-export placeholder in hooks/index.ts | `"여기에서 각 기능의 훅을 다시 내보냅니다:"` |
| `typesGuideComment` | Full comment block for types/index.ts | See below |
| `typesReexportLabel` | Label above re-export placeholder in types/index.ts | `"여기에서 각 기능의 타입을 다시 내보냅니다:"` |

Use the `.join('\n')` pattern for multi-line guide comments:

```typescript
storeGuideComment: [
  '//  📁 스토어 정의 규칙:',
  '//    store/',
  '//      index.ts       ← 이 파일: 모든 스토어를 다시 내보내기',
  '//      todoStore.ts   ← 기능별로 파일 생성',
  '//      ...',
  '//',
  '//  📝 패턴:',
  '//    1. 기능별로 store/<feature>Store.ts 생성',
  '//    2. Zustand의 create()로 스토어 정의',
  '//    3. 이 index.ts에서 다시 내보내기',
  '//',
  '//  ✨ 예시 (store/todoStore.ts):',
].join('\n'),
```

### Step 5 — Add language name to AI system prompts (4 files)

Each system prompt has a `langNames` record that maps language codes to human-readable names. Add the new language to all 4 files.

| File | Line | Current content | Add |
|------|------|----------------|-----|
| `src/engine/system-prompts/coder.ts` | 8 | `{ ja: "Japanese", en: "English" }` | `, {code}: "{English name}"` |
| `src/engine/system-prompts/planner.ts` | 6 | `{ ja: "Japanese", en: "English" }` | `, {code}: "{English name}"` |
| `src/engine/system-prompts/verifier.ts` | 6 | `{ ja: "Japanese", en: "English" }` | `, {code}: "{English name}"` |
| `src/engine/system-prompts/visual-qa.ts` | 6 | `{ ja: "Japanese", en: "English" }` | `, {code}: "{English name}"` |

**Example**:
```typescript
// Before
const langNames: Record<string, string> = { ja: "Japanese", en: "English" };
// After
const langNames: Record<string, string> = { ja: "Japanese", en: "English", ko: "Korean" };
```

### Step 6 — Update documentation

**File**: `docs/spec.md`
**Location**: Line 994 — `"対応言語: 日本語、英語"`
**What to do**: Add the new language to the supported languages list.

```markdown
- 対応言語: 日本語、英語、韓国語
```

## Reference: Complete File Change Summary

| # | File | Action | Details |
|---|------|--------|---------|
| 1 | `src/lib/languages.ts` | Edit `languages` array | Add entry with code, labelKey, nativeName, countryCode, intros, subtitle |
| 2 | `src/locales/{lang}/common.json` | **CREATE** | Full UI translation file (~320 lines) |
| 3 | `src/locales/ja/common.json` | Edit `languages` object | Add new language name in Japanese |
| 4 | `src/locales/en/common.json` | Edit `languages` object | Add new language name in English |
| 5 | `src/lib/template-locale.ts` | Edit `templateLocale` record | Add TemplateLocale entry (8 fields) |
| 6 | `src/engine/system-prompts/coder.ts` | Edit `langNames` | Add mapping |
| 7 | `src/engine/system-prompts/planner.ts` | Edit `langNames` | Add mapping |
| 8 | `src/engine/system-prompts/verifier.ts` | Edit `langNames` | Add mapping |
| 9 | `src/engine/system-prompts/visual-qa.ts` | Edit `langNames` | Add mapping |
| 10 | `docs/spec.md` | Edit supported languages line | Keep doc accurate |

## Files That Do NOT Need Changes

These read from the language system dynamically and require no modification:

| File | Why |
|------|-----|
| `src/components/onboarding/LanguageSelectScreen.tsx` | Renders `languages` array dynamically |
| `src/components/settings/SettingsDialog.tsx` | Reads `languages` array dynamically |
| `src/lib/i18n.ts` | Locale files are auto-discovered via `import.meta.glob`; `getInitialLanguage()` dynamically accepts any registered language |
| `src/store/useAppStore.ts` | Uses `LanguageCode` type (auto-derived), calls `i18n.changeLanguage()` dynamically |
| `src/types/index.ts` | `LanguageCode` type auto-derived from `languages` array |
| `src/lib/template.ts` | `getTemplateFiles()` receives language from locale-aware caller; `lang` attribute set dynamically |
| All `t()` / `useTranslation()` callers | Work automatically once locale JSON exists |
| `src/lib/constants.ts` | Only stores the settings localStorage key |

## Validation

After completing all steps, run the following **in order**:

1. **TypeScript check**: `npx tsc --noEmit`
   - Must produce zero errors
   - Common failure: `languages` object key missing in locale JSON → type mismatch on `labelKey`

2. **Build**: `npm run build` (or `vite build` in the browser variant)
   - Must complete without errors

3. **Manual verification** (or via `agent-browser`):
   - Language selection screen shows the new language button
   - Selecting it changes the UI to the new language
   - Settings dialog shows the new language in the language picker
   - The `LanguageCode` type in `src/types/index.ts` includes the new code (hover test)
   - Create a new app → generated `App.tsx` shows translated waiting state
   - Open `src/engine/system-prompts/coder.ts` → `langNames` includes the new code

4. **Edge cases**:
   - Switch from new language back to Japanese → all UI renders in Japanese
   - Switch from new language back to English → all UI renders in English
   - Refresh the page → language persists from localStorage
   - Clear localStorage → language selection screen shows again
