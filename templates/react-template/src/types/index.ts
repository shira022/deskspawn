// ============================================================
//  Type Definitions
// ============================================================
//
//  📁 型定義のルール:
//    types/
//      index.ts       ← このファイル: 全型定義を re-export
//      todo.ts        ← 機能ごとにファイルを作成
//      user.ts        ← 例: types/user.ts
//      ...
//
//  📝 パターン:
//    1. 機能ごとに types/<feature>.ts を作成
//    2. 型・インターフェースを定義して export
//    3. この index.ts で re-export
//
//  ✨ 例 (types/todo.ts):
//    export interface Todo {
//      id: string;
//      title: string;
//      completed: boolean;
//    }
//    export type TodoFilter = "all" | "active" | "completed";
//
// ============================================================

// ここに各機能の型を re-export:
// export type { Todo, TodoFilter } from "./todo";
