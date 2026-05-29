// ============================================================
//  Custom React Hooks
// ============================================================
//
//  📁 カスタムフックのルール:
//    hooks/
//      index.ts       ← このファイル: 全フックを re-export
//      useTodos.ts    ← 機能ごとにファイルを作成
//      ...
//
//  📝 パターン:
//    1. 機能ごとに hooks/use<Feature>.ts を作成
//    2. Zustand ストアとコンポーネントの橋渡し
//    3. 複雑なロジックはフックに抽出してコンポーネントをシンプルに
//
//  ✨ 例 (hooks/useTodos.ts):
//    import { useTodoStore } from "@/store";
//    import { useCallback } from "react";
//
//    export function useTodos() {
//      const todos = useTodoStore((s) => s.todos);
//      const addTodo = useTodoStore((s) => s.addTodo);
//
//      const handleAdd = useCallback(
//        (title: string) => addTodo(title),
//        [addTodo],
//      );
//
//      return { todos, addTodo: handleAdd };
//    }
//
// ============================================================

// ここに各機能のフックを re-export:
// export { useTodos } from "./useTodos";
