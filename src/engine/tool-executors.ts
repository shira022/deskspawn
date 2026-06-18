/**
 * @deskspawn/browser-engine — Tool executors (browser-compatible)
 *
 * Implements the actual execution of AI agent tools using browser APIs:
 * - File read/write via OPFS/IndexedDB (storage-opfs)
 * - Screenshot via html2canvas (future)
 * - Checkpoints via IndexedDB snapshots
 */

import {
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  listProjectFiles,
} from "@/lib/storage-opfs";
import { saveChatHistory as saveChatToStorage } from "@/lib/storage";
import type { Artifact, FileAction, DiffAction, TemplateAction } from "./types";

// ── Project ID management ──────────────────────────────────────────────────────

let _currentProjectId = "";

export function setProjectId(projectId: string) {
  _currentProjectId = projectId;
}

export function getProjectId(): string {
  return _currentProjectId;
}

// ── File Operations ────────────────────────────────────────────────────────────

/**
 * プロジェクト内のファイルを読み込む。
 * @/ エイリアスを ./src/ に変換して解決する。
 */
export async function readFile(relativePath: string): Promise<string> {
  const pid = getProjectId();
  if (!pid) throw new Error("No project selected. Create or switch to a project first.");

  // @/ エイリアスを実際のパスに変換
  const resolvedPath = relativePath.replace(/^@\//, "src/");
  const content = await readProjectFile(pid, resolvedPath);
  if (content === null) {
    throw new Error(`File not found: ${relativePath}`);
  }
  return content;
}

/**
 * プロジェクト内の全ファイルを一覧表示する。
 */
export async function listFiles(): Promise<Array<{ path: string; size: number; lastModified: string; isDirectory: boolean }>> {
  const pid = getProjectId();
  if (!pid) return [];
  return listProjectFiles(pid);
}

// ── Apply Artifact ─────────────────────────────────────────────────────────────

export interface ApplyResult {
  success: boolean;
  filesChanged: string[];
  errors?: string[];
}

/**
 * AIからのアーティファクト（コード変更）を適用する。
 * ファイル作成/編集、CRUDテンプレート生成に対応。
 */
export async function applyArtifact(artifact: Artifact): Promise<ApplyResult> {
  const pid = getProjectId();
  if (!pid) {
    return { success: false, filesChanged: [], errors: ["No project selected."] };
  }

  const result: ApplyResult = {
    success: true,
    filesChanged: [],
    errors: [],
  };

  if (!artifact.actions || artifact.actions.length === 0) {
    return { success: false, filesChanged: [], errors: ["Missing actions array"] };
  }

  for (const action of artifact.actions) {
    try {
      if (action.type === "file" && action.mode === "file") {
        await executeFileAction(pid, action, result);
      } else if (action.type === "file" && action.mode === "diff") {
        await executeDiffAction(pid, action, result);
      } else if (action.type === "template") {
        await executeTemplateAction(pid, action, result);
      }
    } catch (e: any) {
      result.errors!.push(`${action.type}: ${e.message || e}`);
      result.success = false;
    }
  }

  return result;
}

/**
 * ファイル作成/上書きアクションを実行する。
 */
async function executeFileAction(pid: string, action: FileAction, result: ApplyResult): Promise<void> {
  const resolvedPath = action.filePath.replace(/^@\//, "src/");
  await writeProjectFile(pid, resolvedPath, action.content);
  result.filesChanged.push(action.filePath);
}

/**
 * 差分適用（search/replace）アクションを実行する。
 */
async function executeDiffAction(pid: string, action: DiffAction, result: ApplyResult): Promise<void> {
  const resolvedPath = action.filePath.replace(/^@\//, "src/");
  const existing = await readProjectFile(pid, resolvedPath);
  if (existing === null) {
    throw new Error(`File not found for diff: ${action.filePath}`);
  }

  if (!existing.includes(action.search)) {
    throw new Error(
      `Search string not found in '${action.filePath}'. The content may have already been modified.`,
    );
  }

  const count = existing.split(action.search).length - 1;
  if (count > 1) {
    console.warn(`[diff] Search string appears ${count} times in '${action.filePath}'. Using first occurrence.`);
  }

  const newContent = existing.replace(action.search, action.replace);
  await writeProjectFile(pid, resolvedPath, newContent);
  result.filesChanged.push(action.filePath);
}

/**
 * CRUDテンプレートアクションを実行する。
 * IndexedDBストレージアダプター用のTypeScriptフックを生成する。
 */
async function executeTemplateAction(pid: string, action: TemplateAction, result: ApplyResult): Promise<void> {
  const { tableName, columns: rawColumns } = action;
  const pascalName = toPascalCase(tableName);
  const snakeName = toSnakeCase(tableName);

  const AUTO_COLUMNS = ["created_at", "updated_at"];
  const columns = rawColumns.filter((c) => !AUTO_COLUMNS.includes(c.name));

  const idTsType = "string"; // IndexedDBはstring IDを推奨

  const tsColumns = columns.filter((c) => c.name !== "id");
  const tsFields = tsColumns.map((c) => `  ${c.name}: ${sqlToTsType(c.sqlType, c.nullable)};`).join("\n");
  const collectionName = snakeName;

  const tsHooks = `// @deskspawn:generated table=${snakeName}
// Auto-generated React hooks for ${pascalName}
// Uses the storage adapter (@/lib/storage).

import { getStorage } from "@/lib/storage";

export interface ${pascalName} {
  id: ${idTsType};
${tsFields}
  created_at: string;
  updated_at: string | null;
}

const COLLECTION = "${collectionName}";

export async function get${pascalName}s(): Promise<${pascalName}[]> {
  return getStorage().getAll<${pascalName}>(COLLECTION);
}

export async function get${pascalName}ById(id: ${idTsType}): Promise<${pascalName} | null> {
  return getStorage().getById<${pascalName}>(COLLECTION, String(id));
}

export async function create${pascalName}(data: Omit<${pascalName}, "id" | "created_at" | "updated_at">): Promise<${pascalName}> {
  return getStorage().create<${pascalName}>(COLLECTION, data);
}

export async function update${pascalName}(id: ${idTsType}, data: Partial<Omit<${pascalName}, "id">>): Promise<${pascalName}> {
  return getStorage().update<${pascalName}>(COLLECTION, String(id), data);
}

export async function delete${pascalName}(id: ${idTsType}): Promise<void> {
  return getStorage().remove(COLLECTION, String(id));
}
// @deskspawn:end
`;

  const hooksPath = `src/hooks/use${pascalName}.ts`;
  await writeProjectFile(pid, hooksPath, tsHooks);
  result.filesChanged.push(hooksPath);
}

// ── Error Checking ─────────────────────────────────────────────────────────────

export interface ErrorEntry {
  type: "typescript" | "syntax" | "missing-package" | "vite";
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
}

/**
 * プロジェクトのエラーをチェックする。
 * WebContainer 内で tsc --noEmit を実行し、型エラーを収集する。
 *
 * WebContainer が起動していない場合や tsc が利用できない場合は
 * 空配列を返す（プレビューが Vite 画面上にエラーを表示する）。
 */
export async function getErrors(): Promise<ErrorEntry[]> {
  const pid = getProjectId();
  if (!pid) return [];

  try {
    const { previewManager } = await import("@/lib/preview");

    // WebContainer が未起動なら起動を待つ（最大約60秒）
    // AI が verifier フェーズで get_errors を呼んだときに、まだコンテナが
    // 準備できていないと空配列が返り、エラーがないと誤認識されるのを防ぐ。
    if (!previewManager.isBooted) {
      try {
        await previewManager.boot(pid);
      } catch (e: any) {
        console.warn("[getErrors] WebContainer boot failed:", e?.message || e);
        return [{
          type: "syntax" as const,
          message: `⚠️ WebContainer failed to boot: ${e?.message || e}. Type checking is unavailable.`,
          filePath: "",
        }];
      }
    }

    // 【重要】tsc 実行前に OPFS の最新ファイルをコンテナに同期する
    // AI が apply_artifact で書き込んだ最新コードで型チェックを行うため。
    // package.json が変更されている場合は npm install + dev server 再起動まで行う。
    await previewManager.syncForErrors(pid);

    // 【重要】checkProject() は以下のチェックを実行する:
    //   - tsc --noEmit（TypeScript 型チェック）
    //   - 不足パッケージ検出（import されているが package.json にないパッケージ）
    //   - Vite dev server エラー検出（CSS パース、プラグイン、モジュール解決失敗など）
    const errors = await previewManager.checkProject(pid);
    if (errors.length > 0) {
      const byType = errors.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {} as Record<string, number>);
      console.log(`[getErrors] Found ${errors.length} error(s):`, JSON.stringify(byType));
    } else {
      console.log(`[getErrors] No errors found`);
    }
    return errors;
  } catch (e: any) {
    console.warn("[getErrors] Error checking failed:", e?.message || e);
    return [];
  }
}

// ── Checkpoint System ──────────────────────────────────────────────────────────

interface CheckpointData {
  id: string;
  projectId: string;
  createdAt: string;
  files: Record<string, string>;
}

const CHECKPOINTS_KEY = "deskspawn_checkpoints";

/**
 * チェックポイントをメモリに作成する。
 * ファイル一覧のスナップショットをIndexedDBに保存する。
 */
export async function createCheckpoint(projectId: string, checkpointId?: string): Promise<string> {
  const pid = projectId || getProjectId();
  if (!pid) throw new Error("No project selected.");

  const id = checkpointId || crypto.randomUUID();
  const files = await listProjectFiles(pid);

  // ソースファイルのみをチェックポイントに保存
  const snapshot: Record<string, string> = {};
  for (const file of files) {
    if (file.isDirectory) continue;
    const content = await readProjectFile(pid, file.path);
    if (content !== null) {
      snapshot[file.path] = content;
    }
  }

  // IndexedDBに保存
  const { getSetting, setSetting } = await import("@/lib/storage");
  const existing = (await getSetting<Record<string, CheckpointData>>(CHECKPOINTS_KEY)) || {};
  existing[id] = { id, projectId: pid, createdAt: new Date().toISOString(), files: snapshot };
  await setSetting(CHECKPOINTS_KEY, existing);

  return id;
}

/**
 * チェックポイントから復元する。
 *
 * デスクトップ版の「全削除 → 復元」戦略を踏襲し、復元前にチェックポイント
 * スナップショットに含まれないファイルを削除する（orphaned files 対策）。
 */
export async function restoreCheckpoint(projectId: string, checkpointId: string): Promise<void> {
  const pid = projectId || getProjectId();
  if (!pid) throw new Error("No project selected.");

  const { getSetting } = await import("@/lib/storage");
  const checkpoints = (await getSetting<Record<string, CheckpointData>>(CHECKPOINTS_KEY)) || {};
  const cp = checkpoints[checkpointId] as CheckpointData | undefined;
  if (!cp) throw new Error(`Checkpoint not found: ${checkpointId}`);

  // ── Orphaned files cleanup ──
  // Delete any current project files that aren't in the checkpoint snapshot.
  // This mirrors the desktop version's clearProjectFilesSync() behavior.
  const currentFiles = await listProjectFiles(pid);
  const snapshotPaths = new Set(Object.keys(cp.files));
  for (const file of currentFiles) {
    if (!file.isDirectory && !snapshotPaths.has(file.path)) {
      try {
        await deleteProjectFile(pid, file.path);
      } catch (e) {
        console.warn(`[checkpoint] Failed to clean up orphaned file: ${file.path}`, e);
      }
    }
  }

  // ── Restore files from checkpoint ──
  for (const [filePath, content] of Object.entries(cp.files)) {
    await writeProjectFile(pid, filePath, content);
  }
}

/**
 * チェックポイント一覧を取得する（プロジェクトスコープ）。
 */
export async function listCheckpoints(projectId: string): Promise<Array<{ id: string; createdAt: Date }>> {
  const { getSetting } = await import("@/lib/storage");
  const checkpoints = (await getSetting<Record<string, CheckpointData>>(CHECKPOINTS_KEY)) || {};
  return Object.values(checkpoints)
    .filter((cp): cp is CheckpointData => cp.projectId === projectId)
    .map((cp) => ({ id: cp.id, createdAt: new Date(cp.createdAt) }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * 指定したチェックポイントより後のものを削除する（プロジェクトスコープ）。
 */
export async function deleteCheckpointsAfter(projectId: string, keepCheckpointId: string): Promise<void> {
  const { getSetting, setSetting } = await import("@/lib/storage");
  const checkpoints = (await getSetting<Record<string, CheckpointData>>(CHECKPOINTS_KEY)) || {};
  const all = Object.entries(checkpoints)
    .filter(([, cp]) => cp.projectId === projectId)
    .sort(([, a], [, b]) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const keepIdx = all.findIndex(([id]) => id === keepCheckpointId);
  if (keepIdx === -1) return;

  const toDelete = all.slice(0, keepIdx);
  for (const [id] of toDelete) {
    delete checkpoints[id];
  }
  await setSetting(CHECKPOINTS_KEY, checkpoints);
}

/**
 * 指定したプロジェクトの全チェックポイントを削除する（プロジェクト削除時に呼ぶ）。
 */
export async function deleteProjectCheckpoints(projectId: string): Promise<void> {
  const { getSetting, setSetting } = await import("@/lib/storage");
  const checkpoints = (await getSetting<Record<string, CheckpointData>>(CHECKPOINTS_KEY)) || {};
  let changed = false;
  for (const [id, cp] of Object.entries(checkpoints)) {
    if (cp.projectId === projectId) {
      delete checkpoints[id];
      changed = true;
    }
  }
  if (changed) {
    await setSetting(CHECKPOINTS_KEY, checkpoints);
  }
}

// ── Screenshot ─────────────────────────────────────────────────────────────────

/**
 * iframe 内で検出された問題の構造化データ。
 */
export interface DetectedIssue {
  /** 問題の種類 */
  type: "console-error" | "console-warn" | "dom-error-element" | "vite-error-overlay" | "error-text" | "missing-ui";
  /** 問題の説明 */
  message: string;
  /** 関連するソース（ファイル名やDOMセレクタ） */
  source?: string;
  /** 重大度 */
  severity: "error" | "warning" | "info";
}

export interface ScreenshotResult {
  success: boolean;
  dataUrl?: string;
  error?: string;
  /** メタデータ: DOM要素の要約 */
  elements?: Array<{ tag: string; text?: string; visible: boolean }>;
  /** コンソールエラー（iframeから取得） */
  consoleErrors?: string[];
  /** 構造化された検出済み問題（consoleエラー、DOMエラー表示など） */
  detectedIssues?: DetectedIssue[];
}

interface ScreenshotOptions {
  width?: number;
  height?: number;
  /** 前回のスクリーンショットとピクセル差分を取る */
  compareWithPrevious?: boolean;
  /**
   * iframe の load イベント後にさらに待つ時間（ミリ秒）。
   * アプリ（React/Vite）がレンダリングを完了するのを待つための猶予。
   * デフォルト: 2000ms
   */
  waitAfterLoad?: number;
}

let _previousScreenshot: ImageData | null = null;

/**
 * ブラウザのCSSパーサーを使ってoklch値をrgbaに解決する。
 * html2canvasがoklch()に対応していないため、解決済みの色で上書きCSSを注入するために使う。
 */
function resolveOklchValue(doc: Document, oklchValue: string): string {
  try {
    const el = doc.createElement("div");
    el.style.setProperty("color", oklchValue);
    doc.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    doc.body.removeChild(el);
    // computed returns "rgb(r,g,b)" or "rgba(r,g,b,a)" — valid CSS colors
    if (computed && (computed.startsWith("rgb") || computed.startsWith("rgba"))) {
      return computed;
    }
  } catch {
    // fallthrough
  }
  return oklchValue; // fallback — keep original if resolution fails
}

/**
 * ドキュメント内の全スタイルシートをスキャンし、oklchを含むCSSルールに
 * 解決済みの色(rgba/hex)で上書きルールを注入する。
 * html2canvasがoklch()パースエラーで落ちるのを防ぐ。
 *
 * @returns 注入した<style>要素を削除するクリーンアップ関数。何も注入しなければnull。
 */
function injectOklchFallback(doc: Document): (() => void) | null {
  const overrides: string[] = [];

  const oklchRegex = /oklch\([^)]*\)/g;

  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      // CSSStyleSheet.cssRules にアクセスすると SecurityError が稀に出るので try
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSStyleRule) {
          const style = rule.style;
          const ruleOverrides: string[] = [];
          for (let i = 0; i < style.length; i++) {
            const prop = style[i];
            const val = style.getPropertyValue(prop);
            if (val && oklchRegex.test(val)) {
              oklchRegex.lastIndex = 0;
              const resolved = val.replace(oklchRegex, (match) => resolveOklchValue(doc, match));
              if (resolved !== val) {
                ruleOverrides.push(`${prop}: ${resolved} !important;`);
              }
            }
          }
          if (ruleOverrides.length > 0) {
            overrides.push(`${rule.selectorText} {\n  ${ruleOverrides.join("\n  ")}\n}`);
          }
        }

        // @keyframes ルール
        if (rule instanceof CSSKeyframesRule) {
          for (const kf of Array.from(rule.cssRules)) {
            if (kf instanceof CSSKeyframeRule) {
              const style = kf.style;
              const kfOverrides: string[] = [];
              for (let i = 0; i < style.length; i++) {
                const prop = style[i];
                const val = style.getPropertyValue(prop);
                if (val && oklchRegex.test(val)) {
                  oklchRegex.lastIndex = 0;
                  const resolved = val.replace(oklchRegex, (match) => resolveOklchValue(doc, match));
                  if (resolved !== val) {
                    kfOverrides.push(`${prop}: ${resolved} !important;`);
                  }
                }
              }
              if (kfOverrides.length > 0) {
                overrides.push(`${rule.name} ${kf.keyText} {\n  ${kfOverrides.join("\n  ")}\n}`);
              }
            }
          }
        }
      }
    } catch {
      // クロスオリジンのスタイルシートなど — スキップ
    }
  }

  if (overrides.length > 0) {
    const style = doc.createElement("style");
    style.id = "html2canvas-color-fix";
    style.textContent = overrides.join("\n");
    doc.head.appendChild(style);
    return () => style.remove();
  }

  return null;
}

/**
 * iframe の contentWindow.eval() を安全に呼び出す。
 */
function tryEval(win: { eval: (code: string) => any }, code: string): any {
  try {
    return win.eval(code);
  } catch {
    return undefined;
  }
}

/**
 * iframe 内を検査し、表示・コンソール上のエラーを構造化して返す。
 *
 * 同一オリジンのため contentWindow / contentDocument へのアクセスが可能。
 * 以下のチェックを実行:
 * 1. console.error/warn の横取り（既存の capture + 新規インジェクション）
 * 2. DOM 上のエラー要素（Viteエラーオーバーレイ、エラーバウンダリ、エラーテキスト）
 * 3. ページ内のエラー関連テキストのスキャン
 */
async function detectIframeErrors(iframe: HTMLIFrameElement): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];
  const errorPatterns = [
    /error/i, /typeerror/i, /referenceerror/i, /syntaxerror/i,
    /rangeerror/i, /uriError/i, /failed/i, /cannot read/i,
    /is not defined/i, /unexpected token/i, /unhandled/i,
    /rejected/i, /not found/i, /404/i, /500/i,
  ];

  try {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win?.document;
    if (!win || !doc) return issues;

    // ── 1. Console error capture ──
    // すでに注入済みの guard 変数をチェックし、なければ console.error/warn を横取り
    const iw = win as unknown as { eval: (code: string) => any };

    if (typeof iw.eval === "function") {
      const hasCapture = (() => {
        try {
          return iw.eval("typeof window.__deskspawn_errors !== 'undefined'");
        } catch {
          return false;
        }
      })();

      if (!hasCapture) {
        try {
          iw.eval(`
            (function() {
              if (window.__deskspawn_errors) return;
              window.__deskspawn_errors = [];
              window.__deskspawn_warnings = [];

              var origError = console.error;
              console.error = function() {
                var msg = Array.prototype.slice.call(arguments).map(function(a) {
                  return typeof a === 'string' ? a : (a && a.message) ? a.message : String(a);
                }).join(' ');
                window.__deskspawn_errors.push(msg);
                return origError.apply(this, arguments);
              };

              var origWarn = console.warn;
              console.warn = function() {
                var msg = Array.prototype.slice.call(arguments).map(function(a) {
                  return typeof a === 'string' ? a : (a && a.message) ? a.message : String(a);
                }).join(' ');
                window.__deskspawn_warnings.push(msg);
                return origWarn.apply(this, arguments);
              };

              // グローバルエラーハンドラ
              window.addEventListener('error', function(e) {
                window.__deskspawn_errors.push('Uncaught: ' + (e.message || String(e)));
              });

              window.addEventListener('unhandledrejection', function(e) {
                window.__deskspawn_errors.push('Unhandled Promise: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
              });
            })();
          `);
        } catch {
          // eval が失敗しても処理続行
        }
      }
    }

    // 保存されたエラー/警告を読み取り
    try {
      const errorsRaw = tryEval(iw, "window.__deskspawn_errors || []");
      const warningsRaw = tryEval(iw, "window.__deskspawn_warnings || []");
      const errors: string[] = Array.isArray(errorsRaw) ? errorsRaw : [];
      const warnings: string[] = Array.isArray(warningsRaw) ? warningsRaw : [];

      for (const err of errors.slice(-10)) {
        issues.push({
          type: "console-error",
          message: err,
          severity: "error",
          source: "iframe:console.error",
        });
      }
      for (const warn of warnings.slice(-10)) {
        issues.push({
          type: "console-warn",
          message: warn,
          severity: "warning",
          source: "iframe:console.warn",
        });
      }
    } catch {
      // 読み取り失敗 — スキップ
    }

    // ── 2. DOM error element scan ──
    // Vite error overlay
    const viteOverlay = doc.querySelector("vite-error-overlay, error-overlay, #vite-error-overlay");
    if (viteOverlay) {
      const text = (viteOverlay.textContent || "").trim().substring(0, 500);
      issues.push({
        type: "vite-error-overlay",
        message: text || "Vite error overlay detected",
        source: "iframe:dom",
        severity: "error",
      });
    }

    // Error boundary / error display elements
    const errorSelectors = [
      '[data-testid="error-boundary"]',
      '[role="alert"]',
      '.error-boundary',
      '.error-fallback',
      '.error-container',
      '#error-boundary',
      '[class*="error"]:not([class*="hover"]):not([class*="focus"]):not([class*="active"])',
    ];
    // より具体的なセレクタから順にチェック
    for (const sel of errorSelectors) {
      try {
        const els = doc.querySelectorAll(sel);
        for (const el of Array.from(els)) {
          const text = (el as HTMLElement).textContent?.trim().substring(0, 300);
          const tag = (el as HTMLElement).tagName.toLowerCase();
          const visible = (el as HTMLElement).offsetParent !== null;
          if (visible && text && text.length > 0) {
            issues.push({
              type: "dom-error-element",
              message: `<${tag}> ${text.substring(0, 200)}`,
              source: `iframe:dom${sel}`,
              severity: "error",
            });
          }
        }
      } catch {
        // 個別セレクタのエラーは無視
      }
    }

    // ── 3. Error text content scan ──
    // ページ内の主要テキストノードからエラーパターンを検出
    const textElements = doc.querySelectorAll("h1, h2, h3, h4, p, li, pre, code, div:not([class*=\"nav\"]):not([class*=\"header\"]):not([class*=\"footer\"])");
    const scanned = new Set<string>();

    for (const el of Array.from(textElements).slice(0, 100)) {
      const text = (el as HTMLElement).textContent?.trim();
      if (!text || text.length < 3 || scanned.has(text)) continue;
      scanned.add(text);

      const visible = (el as HTMLElement).offsetParent !== null;
      if (!visible) continue;

      for (const pattern of errorPatterns) {
        if (pattern.test(text) && text.length < 500) {
          // スタックトレースの一部でないかチェック（at File:line:col パターン）
          const isStackFrame = /^\s*at\s/.test(text);
          if (isStackFrame) continue;

          issues.push({
            type: "error-text",
            message: `<${(el as HTMLElement).tagName.toLowerCase()}> ${text.substring(0, 200)}`,
            source: "iframe:dom:text-scan",
            severity: text.toLowerCase().includes("error") || text.toLowerCase().includes("fail") ? "error" : "warning",
          });
          break; // 最初のマッチのみ
        }
      }
    }

  } catch {
    // iframeへのアクセス自体が失敗 — エラー情報なしで続行
  }

  return issues;
}

/**
 * iframe 内のコンテンツ読み込み完了とレンダリング完了を待つ。
 *
 * 1. iframe の load イベントを待つ（初期HTML読み込み）
 * 2. その後に waitAfterLoad ミリ秒待つ（React/Vite のレンダリング完了待ち）
 * 3. 安全策として 30 秒でタイムアウト
 */
async function waitForIframeReady(iframe: HTMLIFrameElement, waitAfterLoad: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false;

    const done = () => {
      if (resolved) return;
      resolved = true;

      // load 完了後さらに waitAfterLoad ms 待ってレンダリング完了を待つ
      setTimeout(resolve, waitAfterLoad);
    };

    // すでに読み込み済みなら即座にレンダリング待機へ
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc && doc.readyState === "complete") {
        setTimeout(resolve, waitAfterLoad);
        return;
      }
    } catch {
      // クロスオリジン — load イベントだけ待つ
    }

    iframe.addEventListener("load", done, { once: true });

    // 安全タイムアウト（最長 30 秒）
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        iframe.removeEventListener("load", done);
        resolve();
      }
    }, 30000);
  });
}

/**
 * スクリーンショットを撮影する（html2canvas + pixelmatch 差分比較）。
 *
 * html2canvas v1.4.1 は oklch() 色関数に対応していないため、撮影前に
 * iframe内のCSSをスキャンして oklch → rgba の上書きルールを注入する。
 *
 * 撮影前には下記の順で準備を行う:
 * 1. iframe の load イベント完了を待つ
 * 2. waitAfterLoad ms 待ってアプリのレンダリング完了を待つ
 * 3. oklch フォールバックCSSを注入
 * 4. html2canvas で撮影
 */
export async function takeScreenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
  try {
    const previewIframe = document.getElementById("preview-iframe") as HTMLIFrameElement | null;
    if (!previewIframe) {
      return { success: false, error: "Preview iframe not found." };
    }

    // --- iframe コンテンツの読み込み + レンダリング完了を待つ ---
    const waitMs = options?.waitAfterLoad ?? 2000;
    console.log(`[takeScreenshot] Waiting for iframe content load + ${waitMs}ms render time...`);
    await waitForIframeReady(previewIframe, waitMs);
    console.log(`[takeScreenshot] Iframe ready, capturing...`);

    // --- oklch fallback: html2canvasがoklchをパースできない問題を回避 ---
    try {
      const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow?.document;
      if (iframeDoc) {
        injectOklchFallback(iframeDoc);
      }
    } catch {
      // iframeがクロスオリジン等 — fallbackなしでも撮影を試みる
    }

    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(previewIframe, {
      width: options?.width || 1280,
      height: options?.height || 720,
      useCORS: true,
      allowTaint: true,
    });

    // iframe 内のエラー検出（console + DOM）
    let detectedIssues: DetectedIssue[] = [];
    try {
      detectedIssues = await detectIframeErrors(previewIframe);
      if (detectedIssues.length > 0) {
        console.log(`[takeScreenshot] Detected ${detectedIssues.length} issue(s):`, detectedIssues.map(i => `[${i.severity}] ${i.type}: ${i.message.substring(0, 60)}`));
      }
    } catch {
      // エラー検出の失敗は無視
    }

    // DOM要素のメタデータ収集（iframe内のDOMにアクセス試行）
    let elements: Array<{ tag: string; text?: string; visible: boolean }> = [];
    let consoleErrors: string[] = detectedIssues
      .filter(i => i.type === "console-error")
      .map(i => i.message);
    try {
      const iframeDoc = previewIframe.contentDocument || previewIframe.contentWindow?.document;
      if (iframeDoc) {
        elements = Array.from(iframeDoc.querySelectorAll("h1, h2, h3, button, p, span, div[class]")).slice(0, 50).map((el) => ({
          tag: (el as HTMLElement).tagName.toLowerCase(),
          text: (el as HTMLElement).textContent?.trim().substring(0, 100) || undefined,
          visible: (el as HTMLElement).offsetParent !== null,
        }));
      }
    } catch {
      // iframeがsandbox/クロスオリジンでDOMにアクセスできない
    }

    // ピクセル差分（pixelmatch）
    if (options?.compareWithPrevious && _previousScreenshot) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const diffCanvas = document.createElement("canvas");
        diffCanvas.width = canvas.width;
        diffCanvas.height = canvas.height;
        const diffCtx = diffCanvas.getContext("2d");
        if (diffCtx) {
          const diffData = diffCtx.createImageData(canvas.width, canvas.height);
          const pixelmatch = (await import("pixelmatch")).default;
          pixelmatch(_previousScreenshot.data, current.data, diffData.data, canvas.width, canvas.height, { threshold: 0.1 });
          diffCtx.putImageData(diffData, 0, 0);
          // 差分オーバーレイ付きの画像を生成
          diffCtx.globalAlpha = 0.5;
          diffCtx.drawImage(canvas, 0, 0);
          // 元画像を元に戻し、差分を重ねる
          const changedPixels = diffData.data.filter((_, i) => i % 4 === 0 && diffData.data[i] > 0).length;
          if (changedPixels > 0) {
            // 差分がある場合のみオーバーレイ
            const merged = document.createElement("canvas");
            merged.width = canvas.width;
            merged.height = canvas.height;
            const mergedCtx = merged.getContext("2d")!;
            mergedCtx.putImageData(current, 0, 0);
            // 差分領域を赤く着色
            const visibleDiff = new Uint8ClampedArray(diffData.data.length);
            for (let i = 0; i < diffData.data.length; i += 4) {
              if (diffData.data[i] > 0) {
                visibleDiff[i] = 255;     // R
                visibleDiff[i + 1] = 0;   // G
                visibleDiff[i + 2] = 0;   // B  
                visibleDiff[i + 3] = 128; // A
              }
            }
            mergedCtx.putImageData(new ImageData(visibleDiff, canvas.width, canvas.height), 0, 0);
            return {
              success: true,
              dataUrl: merged.toDataURL("image/jpeg", 0.85),
              elements,
              consoleErrors,
              detectedIssues,
            };
          }
        }
      }
    }

    // 前回のスクリーンショットとして保存
    const ctx = canvas.getContext("2d");
    if (ctx) {
      _previousScreenshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    return {
      success: true,
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      elements,
      consoleErrors,
      detectedIssues,
    };
  } catch (e: any) {
    return { success: false, error: e.message || String(e) };
  }
}

// ── Chat History ───────────────────────────────────────────────────────────────

/**
 * チャット履歴をIndexedDBに永続化する。
 */
export async function persistChatHistory(projectId: string, messages: any[]): Promise<void> {
  await saveChatToStorage(projectId, messages);
}

/**
 * チャット履歴をIndexedDBから読み込む。
 */
export async function loadChatHistory(projectId: string): Promise<any[]> {
  const { getChatHistory } = await import("@/lib/storage");
  return getChatHistory(projectId);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toPascalCase(s: string): string {
  return s.split("_").filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function toSnakeCase(s: string): string {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).replace(/^_/, "");
}

function sqlToTsType(sqlType: string, nullable: boolean): string {
  let base = "string";
  switch (sqlType.toUpperCase()) {
    case "INTEGER": case "INT": case "BIGINT": base = "number"; break;
    case "REAL": case "FLOAT": case "DOUBLE": base = "number"; break;
    case "BOOLEAN": case "BOOL": base = "boolean"; break;
  }
  return nullable ? `${base} | null` : base;
}
