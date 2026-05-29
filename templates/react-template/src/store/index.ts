// ============================================================
//  State Management (Zustand)
// ============================================================
//
//  📁 ストア定義のルール:
//    store/
//      index.ts       ← このファイル: 全ストアを re-export
//      todoStore.ts   ← 機能ごとにファイルを作成
//      userStore.ts   ← 例: store/userStore.ts
//      ...
//
//  📝 パターン:
//    1. 機能ごとに store/<feature>Store.ts を作成
//    2. Zustand の create() でストアを定義
//    3. この index.ts で re-export
//
//  ✨ 例 (store/todoStore.ts):
//    import { create } from "zustand";
//
//    interface TodoStore {
//      todos: Todo[];
//      addTodo: (title: string) => void;
//      toggleTodo: (id: string) => void;
//    }
//
//    export const useTodoStore = create<TodoStore>((set) => ({
//      todos: [],
//      addTodo: (title) =>
//        set((state) => ({
//          todos: [...state.todos, { id: crypto.randomUUID(), title, completed: false }],
//        })),
//      toggleTodo: (id) =>
//        set((state) => ({
//          todos: state.todos.map((t) =>
//            t.id === id ? { ...t, completed: !t.completed } : t
//          ),
//        })),
//    }));
//
// ============================================================

// ここに各機能のストアを re-export:
// export { useTodoStore } from "./todoStore";
