// ============================================================
// Template Locale — localized strings for the default project template
// ============================================================
//
// When adding a new language:
//   1. Add the language code to src/lib/languages.ts
//   2. Add a TemplateLocale entry below with translations for each field
//   3. Template code itself needs no changes
//
// ============================================================

/**
 * Locale-specific strings injected into the default project template.
 * Only the user-facing text and developer guide comments are here;
 * the example code and structural parts live in template.ts.
 */
export interface TemplateLocale {
  // ── App.tsx — waiting state UI ─────────────────────────────────────
  /** Heading text shown before the AI generates the app */
  appWaitingTitle: string;
  /** First line of description (before <br />) */
  appWaitingDescLine1: string;
  /** Second line of description (after <br />) */
  appWaitingDescLine2: string;

  // ── store/index.ts — developer guide comment ──────────────────────
  /** Full comment block: directory rules + pattern + example title */
  storeGuideComment: string;
  /** Label above the re-export placeholder line */
  storeReexportLabel: string;

  // ── hooks/index.ts — developer guide comment ──────────────────────
  /** Full comment block: directory rules + pattern + example title */
  hooksGuideComment: string;
  /** Label above the re-export placeholder line */
  hooksReexportLabel: string;

  // ── types/index.ts — developer guide comment ──────────────────────
  /** Full comment block: directory rules + pattern + example title */
  typesGuideComment: string;
  /** Label above the re-export placeholder line */
  typesReexportLabel: string;
}

/** Map of language code → template locale */
export const templateLocale: Record<string, TemplateLocale> = {
  // ── Japanese ─────────────────────────────────────────────────────
  ja: {
    appWaitingTitle: "アプリの生成を待機しています",
    appWaitingDescLine1: "AIチャットでアプリの指示を送信すると、",
    appWaitingDescLine2: "ここにリアルタイムプレビューが表示されます。",

    storeGuideComment: [
      '//  📁 ストア定義のルール:',
      '//    store/',
      '//      index.ts       ← このファイル: 全ストアを re-export',
      '//      todoStore.ts   ← 機能ごとにファイルを作成',
      '//      userStore.ts   ← 例: store/userStore.ts',
      '//      ...',
      '//',
      '//  📝 パターン:',
      '//    1. 機能ごとに store/<feature>Store.ts を作成',
      '//    2. Zustand の create() でストアを定義',
      '//    3. この index.ts で re-export',
      '//',
      '//  ✨ 例 (store/todoStore.ts):',
    ].join('\n'),
    storeReexportLabel: "ここに各機能のストアを re-export:",

    hooksGuideComment: [
      '//  📁 カスタムフックのルール:',
      '//    hooks/',
      '//      index.ts       ← このファイル: 全フックを re-export',
      '//      useTodos.ts    ← 機能ごとにファイルを作成',
      '//      ...',
      '//',
      '//  📝 パターン:',
      '//    1. 機能ごとに hooks/use<Feature>.ts を作成',
      '//    2. Zustand ストアとコンポーネントの橋渡し',
      '//    3. 複雑なロジックはフックに抽出してコンポーネントをシンプルに',
      '//',
      '//  ✨ 例 (hooks/useTodos.ts):',
    ].join('\n'),
    hooksReexportLabel: "ここに各機能のフックを re-export:",

    typesGuideComment: [
      '//  📁 型定義のルール:',
      '//    types/',
      '//      index.ts       ← このファイル: 全型定義を re-export',
      '//      todo.ts        ← 機能ごとにファイルを作成',
      '//      user.ts        ← 例: types/user.ts',
      '//      ...',
      '//',
      '//  📝 パターン:',
      '//    1. 機能ごとに types/<feature>.ts を作成',
      '//    2. 型・インターフェースを定義して export',
      '//    3. この index.ts で re-export',
      '//',
      '//  ✨ 例 (types/todo.ts):',
    ].join('\n'),
    typesReexportLabel: "ここに各機能の型を re-export:",
  },

  // ── English ──────────────────────────────────────────────────────
  en: {
    appWaitingTitle: "Waiting for app generation",
    appWaitingDescLine1: "Send instructions via the AI chat,",
    appWaitingDescLine2: "and the live preview will appear here.",

    storeGuideComment: [
      '//  📁 Store Definition Rules:',
      '//    store/',
      '//      index.ts       ← This file: re-export all stores',
      '//      todoStore.ts   ← One file per feature',
      '//      userStore.ts   ← e.g. store/userStore.ts',
      '//      ...',
      '//',
      '//  📝 Pattern:',
      '//    1. Create store/<feature>Store.ts per feature',
      '//    2. Define store with Zustand\'s create()',
      '//    3. Re-export in this index.ts',
      '//',
      '//  ✨ Example (store/todoStore.ts):',
    ].join('\n'),
    storeReexportLabel: "Re-export feature stores here:",

    hooksGuideComment: [
      '//  📁 Custom Hook Rules:',
      '//    hooks/',
      '//      index.ts       ← This file: re-export all hooks',
      '//      useTodos.ts    ← One file per feature',
      '//      ...',
      '//',
      '//  📝 Pattern:',
      '//    1. Create hooks/use<Feature>.ts per feature',
      '//    2. Bridge between Zustand stores and components',
      '//    3. Extract complex logic into hooks to keep components simple',
      '//',
      '//  ✨ Example (hooks/useTodos.ts):',
    ].join('\n'),
    hooksReexportLabel: "Re-export feature hooks here:",

    typesGuideComment: [
      '//  📁 Type Definition Rules:',
      '//    types/',
      '//      index.ts       ← This file: re-export all types',
      '//      todo.ts        ← One file per feature',
      '//      user.ts        ← e.g. types/user.ts',
      '//      ...',
      '//',
      '//  📝 Pattern:',
      '//    1. Create types/<feature>.ts per feature',
      '//    2. Define and export types/interfaces',
      '//    3. Re-export in this index.ts',
      '//',
      '//  ✨ Example (types/todo.ts):',
    ].join('\n'),
    typesReexportLabel: "Re-export feature types here:",
  },
};
