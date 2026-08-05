/**
 * プレビューシステムの型定義
 *
 * WebContainerベースのプレビューで使用する型を一元管理する。
 */

/** プレビューの状態 */
export type PreviewStatus =
  | "idle"
  | "booting"
  | "installing"
  | "starting-dev"
  | "ready"
  | "syncing"
  | "error";

/** プレビューの外部公開状態 */
export interface PreviewState {
  status: PreviewStatus;
  url: string | null;
  error: string | null;
  /** 起動/同期の進捗ログ（新しいものほど後ろ） */
  logs: string[];
}

/** ファイル同期結果 */
export interface SyncResult {
  filesSynced: number;
  installTriggered: boolean;
  errors: string[];
}

/** 状態変更リスナー */
export type StateListener = (state: PreviewState) => void;

/** 型チェックエラー（checkProject/getErrors 戻り値） */
export interface ErrorEntry {
  type: "typescript" | "syntax" | "missing-package" | "vite";
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
}
