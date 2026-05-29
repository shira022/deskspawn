// ============================================================
//  DeskSpawn Generated App — Root Component
// ============================================================
//
//  📁 Project Structure:
//
//    src/
//      types/          → TypeScript type definitions
//        index.ts      →  Re-export all types here
//        todo.ts       →  One file per feature domain
//
//      store/          → Zustand state management
//        index.ts      →  Re-export all stores here
//        todoStore.ts  →  One store file per feature
//
//      api/            → API communication layer
//        client.ts     →  Base fetch / Tauri invoke wrapper
//        todoApi.ts    →  One API file per feature
//
//      hooks/          → Custom React hooks
//        index.ts      →  Re-export all hooks here
//        useTodos.ts   →  One hook file per feature
//
//      components/     → UI components
//        features/     →  Feature-specific components
//        ui/           →  Reusable primitives (create as needed)
//
//      lib/            → Utility functions
//      App.tsx         → ★ COMPOSITION ROOT (keep minimal)
//      main.tsx        → Entry point
//
//  ⚠️ RULES:
//    1. App.tsx is the COMPOSITION ROOT only — keep it minimal
//    2. When adding a feature, ALWAYS create separate files:
//       types/X.ts + store/XStore.ts + components/X.tsx
//    3. Import from each directory in App.tsx to compose the app
//
// ============================================================

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-8">
      <div className="text-center space-y-4 max-w-md">
        <div className="flex justify-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <svg
              className="h-6 w-6 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
              />
            </svg>
          </div>
        </div>
        <h1 className="text-xl font-semibold">コードの生成を待機しています</h1>
        <p className="text-sm text-muted-foreground">
          AIチャットでアプリの指示を送信すると、
          <br />
          ここにリアルタイムプレビューが表示されます。
        </p>
      </div>
    </div>
  );
}
