/**
 * ファイル同期 — OPFS/IndexedDB → WebContainer
 *
 * プロジェクトファイルの変更を検出し、WebContainerのファイルシステムに
 * 同期する。package.json の変更も検出し、npm install が必要か判断する。
 */

import type { WebContainer } from "@webcontainer/api";
import { listProjectFiles, readProjectFile } from "@/lib/storage-opfs";
import type { SyncResult } from "./types";

// ── ファイルフィルター ────────────────────────────────────────────────────────

/** 同期対象外のファイル */
const EXCLUDE_PATTERNS = [
  "node_modules/",
  "package-lock.json",
  ".git/",
  "dist/",
  ".tsbuildinfo",
];

function shouldSync(filePath: string): boolean {
  if (EXCLUDE_PATTERNS.some((p) => filePath.startsWith(p) || filePath.endsWith(".tsbuildinfo"))) {
    return false;
  }
  return true;
}

// ── ファイル同期 ──────────────────────────────────────────────────────────────

/**
 * OPFSから全プロジェクトファイルを読み込み、WebContainerにマウントする。
 * 初回マウント用。
 */
export async function mountAllFiles(
  container: WebContainer,
  projectId: string,
): Promise<void> {
  const allFiles = await listProjectFiles(projectId);

  // FileSystemTree 形式に変換
  const tree: Record<string, any> = {};

  for (const file of allFiles) {
    if (file.isDirectory || !shouldSync(file.path)) continue;

    const content = await readProjectFile(projectId, file.path);
    if (content === null) continue;

    setTreePath(tree, file.path, content);
  }

  await container.mount(tree);
}

/**
 * ツリー構造にファイルパスをセットする再帰ヘルパー。
 *
 * 例: setTreePath({}, "src/main.tsx", "content")
 *   → { src: { directory: { "main.tsx": { file: { contents: "content" } } } } }
 */
function setTreePath(
  tree: Record<string, any>,
  path: string,
  content: string,
): void {
  const parts = path.split("/");
  let current = tree;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;

    if (isLast) {
      current[part] = { file: { contents: content } };
    } else {
      if (!current[part]) {
        current[part] = { directory: {} };
      }
      current = current[part].directory;
    }
  }
}

/**
 * package.json の内容をWebContainerから読み込む。
 */
async function readContainerPackageJson(
  container: WebContainer,
): Promise<string | null> {
  try {
    return await container.fs.readFile("/package.json", "utf-8");
  } catch {
    return null;
  }
}

/**
 * package.json の変更を検出する。
 * 変更があれば true を返す。
 */
export async function detectPackageJsonChange(
  container: WebContainer,
  projectId: string,
): Promise<boolean> {
  const prev = await readContainerPackageJson(container);
  const current = await readProjectFile(projectId, "package.json");

  if (current === null && prev === null) {
    console.log(`[preview] detectPackageJsonChange: both null → no change`);
    return false;
  }
  if (current === null || prev === null) {
    console.log(`[preview] detectPackageJsonChange: one is null → changed (prev=${prev !== null}, current=${current !== null})`);
    return true;
  }

  // dependencies/devDependencies のみ比較（フォーマット差異を無視）
  try {
    const prevPkg = JSON.parse(prev);
    const currPkg = JSON.parse(current);

    const prevDeps = JSON.stringify({
      d: prevPkg.dependencies || {},
      dd: prevPkg.devDependencies || {},
    });
    const currDeps = JSON.stringify({
      d: currPkg.dependencies || {},
      dd: currPkg.devDependencies || {},
    });

    const changed = prevDeps !== currDeps;
    if (changed) {
      console.log(`[preview] detectPackageJsonChange: dependencies changed`);
      // Log the diff
      const prevKeys = Object.keys(prevPkg.dependencies || {});
      const currKeys = Object.keys(currPkg.dependencies || {});
      const added = currKeys.filter(k => !prevKeys.includes(k));
      const removed = prevKeys.filter(k => !currKeys.includes(k));
      if (added.length > 0) console.log(`[preview]   added: ${added.join(', ')}`);
      if (removed.length > 0) console.log(`[preview]   removed: ${removed.join(', ')}`);
    } else {
      console.log(`[preview] detectPackageJsonChange: dependencies unchanged`);
    }
    return changed;
  } catch {
    // パースできない場合はファイル全体を比較
    const changed = prev !== current;
    console.log(`[preview] detectPackageJsonChange: parse fallback → ${changed ? 'changed' : 'unchanged'}`);
    return changed;
  }
}

/**
 * 変更されたファイルのみをWebContainerに同期する。
 * package.json が変更されたかどうかを返す。
 *
 * 全ファイルをなめてOPFSの内容とコンテナの内容を比較し、
 * 差分があるものだけ書き込む（効率化のため）。
 * ただし初回や多数ファイル変更時は全書込みを行う。
 *
 * 全ファイルの同期完了後、タッチファイルを書き込んで Vite に
 * 完全再ビルドをトリガーさせる（中途半端な HMR 状態を防止）。
 */
export async function syncChangedFiles(
  container: WebContainer,
  projectId: string,
): Promise<SyncResult> {
  const allFiles = await listProjectFiles(projectId);
  let filesSynced = 0;
  const errors: string[] = [];
  let pkgChanged = false;

  for (const file of allFiles) {
    if (file.isDirectory || !shouldSync(file.path)) continue;

    try {
      const content = await readProjectFile(projectId, file.path);
      if (content === null) continue;

      // コンテナ上の既存ファイルと比較
      let needsWrite = true;
      try {
        const existing = await container.fs.readFile("/" + file.path, "utf-8");
        needsWrite = existing !== content;
      } catch {
        // ファイルが存在しない → 書き込み必要
      }

      if (needsWrite) {
        // ディレクトリが存在することを確認（再帰的mkdir相当）
        const dirPath = "/" + file.path.split("/").slice(0, -1).join("/");
        if (dirPath !== "/") {
          try {
            await container.fs.mkdir(dirPath, { recursive: true });
          } catch {
            // 既に存在する場合は無視
          }
        }

        await container.fs.writeFile("/" + file.path, content);
        filesSynced++;

        if (file.path === "package.json") {
          pkgChanged = true;
        }
      }
    } catch (e: any) {
      errors.push(`${file.path}: ${e.message || e}`);
    }
  }

  // 全ファイル同期完了後、タッチファイルを作成して Vite に
  // 完全な状態での再ビルドを促す。これにより HMR が中途半端な状態で
  // トリガーされるのを防ぐ。
  if (filesSynced > 0) {
    try {
      const touchContent = JSON.stringify({
        syncedAt: Date.now(),
        filesSynced,
      });
      await container.fs.writeFile("/.deskspawn-sync-trigger", touchContent);
    } catch {
      // タッチファイルの作成はベストエフォート
    }
  }

  return { filesSynced, installTriggered: pkgChanged, errors };
}
