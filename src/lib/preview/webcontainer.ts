/**
 * WebContainer マネージャー
 *
 * WebContainerのライフサイクル（boot → mount → install → dev → teardown）を
 * 管理するシングルインスタンス。
 * React のレンダーサイクルとは独立して動作し、状態変更を購読可能。
 */

import { WebContainer } from "@webcontainer/api";
import type { PreviewState, PreviewStatus, StateListener } from "./types";
import { mountAllFiles, syncChangedFiles, detectPackageJsonChange } from "./file-sync";
import { readProjectFile, listProjectFiles } from "@/lib/storage-opfs";

// ── 定数 ─────────────────────────────────────────────────────────────────────

/** npm install 出力の最大行数（メモリ節約） */
const INSTALL_OUTPUT_LIMIT = 200;

/** サーバー起動の最大待機時間 (ms) */
const SERVER_READY_TIMEOUT = 30_000;

// ── シングルトンマネージャー ─────────────────────────────────────────────────

export class PreviewManager {
  private container: WebContainer | null = null;
  private currentProjectId: string | null = null;
  private devServerProcess: Awaited<ReturnType<WebContainer["spawn"]>> | null = null;
  private unsubServerReady: (() => void) | null = null;
  private unsubPort: (() => void) | null = null;

  // 状態
  private _status: PreviewStatus = "idle";
  private _url: string | null = null;
  private _error: string | null = null;
  private _logs: string[] = [];
  private listeners = new Set<StateListener>();
  private bootPromise: Promise<void> | null = null;

  // Vite dev server出力キャプチャ
  private _viteOutputBuffer: string[] = [];
  private _viteOutputReader: ReadableStreamDefaultReader<string> | null = null;
  private _readingViteOutput = false;
  private static readonly MAX_VITE_OUTPUT_LINES = 200;
  /** Viteエラーと判定するパターン（1行単位） */
  private static readonly VITE_ERROR_PATTERNS: RegExp[] = [
    /✗\s*\[vite\]/,
    /✗\s*Internal server error/,
    /✗\s*\[plugin:/,
    /\[vite\] Internal server error/,
    /Failed to resolve import/,
    /Could not resolve/,
    /Module not found/,
    /✗\s*(?:Error|error)/,
    /error when starting dev server/i,
    /✗\s*Build error/,
  ];

  // ── 状態管理 ──────────────────────────────────────────────────────────

  private get state(): PreviewState {
    return { status: this._status, url: this._url, error: this._error, logs: this._logs };
  }

  private setState(partial: Partial<PreviewState>): void {
    if (partial.status !== undefined) this._status = partial.status;
    if (partial.url !== undefined) this._url = partial.url;
    if (partial.error !== undefined) this._error = partial.error;
    this.notify();
  }

  /** 進捗ログを追加して購読者に通知する */
  private addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this._logs = [...this._logs, `[${timestamp}] ${message}`];
    this.notify();
  }

  /** ログをクリアする */
  private clearLogs(): void {
    this._logs = [];
    this.notify();
  }

  private notify(): void {
    const state = this.state;
    for (const fn of this.listeners) {
      try {
        fn(state);
      } catch {
        // リスナーエラーは無視
      }
    }
  }

  /** 状態変更を購読する。購読解除関数を返す。 */
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    // 初回は即座に現在の状態を通知
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── ライフサイクル ────────────────────────────────────────────────────

  /** WebContainerが起動済みか */
  get isBooted(): boolean {
    return this.container !== null && this._status !== "idle";
  }

  /** 現在のプロジェクトID */
  get projectId(): string | null {
    return this.currentProjectId;
  }

  /** プレビューURL */
  get url(): string | null {
    return this._url;
  }

  /** コンテナを起動し、ファイルをマウント、npm install、devサーバー起動まで行う。 */
  async boot(projectId: string): Promise<void> {
    // 同じプロジェクトかつ既に起動済みならスキップ
    if (this.currentProjectId === projectId && this.container && this._status === "ready") {
      return;
    }

    // 並行起動を防止
    if (this.bootPromise) {
      if (this.currentProjectId !== projectId) {
        // 別のプロジェクトが起動中 → 強制終了して新しいプロジェクトを起動
        this.teardown();
        this.bootPromise = null;
      } else {
        return this.bootPromise;
      }
    }

    this.bootPromise = this._boot(projectId);
    try {
      await this.bootPromise;
    } finally {
      this.bootPromise = null;
    }
  }

  /** プロジェクト切り替わり検出 — currentProjectIdが期待値と異なる場合はtrue */
  private _isOvertaken(projectId: string): boolean {
    return this.currentProjectId !== projectId;
  }

  /**
   * WebContainer.boot() をリトライ付きで実行する。
   * タブがバックグラウンドのときに boot が失敗することがあるため、
   * リトライ間隔を空けて最大3回試行する。
   * プロジェクトが切り替わった場合は速やかに中断する。
   */
  private async _bootWebContainer(projectId: string): Promise<WebContainer> {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          this.addLog(`Booting WebContainer... (retry ${attempt}/${MAX_RETRIES})`);
        } else {
          this.addLog("Booting WebContainer...");
        }
        return await WebContainer.boot({
          coep: "credentialless",
          forwardPreviewErrors: "exceptions-only",
        });
      } catch (e: any) {
        if (attempt === MAX_RETRIES) throw e;
        // プロジェクト切り替わり時はリトライせず中断
        if (this._isOvertaken(projectId)) {
          throw e;
        }
        this.addLog(`Boot attempt ${attempt} failed (${e.message || String(e)}), retrying...`);
        await new Promise((r) => setTimeout(r, 500 * attempt));
        // 待機中にプロジェクトが変わった場合も中断
        if (this._isOvertaken(projectId)) {
          throw new Error("Boot aborted: project switched during retry delay");
        }
      }
    }
    throw new Error("WebContainer.boot failed after all retries");
  }

  private async _boot(projectId: string): Promise<void> {
    // 既存のコンテナを必ず破棄してから新しく起動する（リソースリーク防止）
    if (this.container) {
      this.teardown();
    }
    this.clearLogs();

    this.currentProjectId = projectId;
    this.addLog(`Starting preview for project: ${projectId}`);
    this.setState({ status: "booting", error: null });

    try {
      // Boot — リトライ付き
      const newContainer = await this._bootWebContainer(projectId);
      if (this._isOvertaken(projectId)) {
        this.addLog(`Boot aborted: project switched during WebContainer.boot()`);
        newContainer.teardown();
        return;
      }
      this.container = newContainer;
      this.addLog("WebContainer booted successfully");

      // サーバー準備完了イベント（リスナー内でもプロジェクト一致を確認）
      this.unsubServerReady = this.container.on("server-ready", (_port, url) => {
        if (this._isOvertaken(projectId)) return;
        this.addLog(`Dev server ready at ${url}`);
        this.setState({ url, status: "ready" });
      });

      // ポートオープン/クローズ
      this.unsubPort = this.container.on("port", (_port, type, url) => {
        if (this._isOvertaken(projectId)) return;
        if (type === "open") {
          this.setState({ url });
        }
      });

      // ファイルマウント
      this.setState({ status: "booting" });
      this.addLog("Mounting project files...");
      await mountAllFiles(this.container, projectId);
      if (this._isOvertaken(projectId)) {
        this.addLog(`Boot aborted: project switched during file mount`);
        return;
      }
      this.addLog("Project files mounted");

      // npm install
      this.addLog("Installing dependencies (npm install)...");
      await this._runNpmInstall();
      if (this._isOvertaken(projectId)) {
        this.addLog(`Boot aborted: project switched during npm install`);
        return;
      }
      this.addLog("Dependencies installed");

      // Dev server 起動
      this.addLog("Starting dev server...");
      await this._startDevServer();
      if (this._isOvertaken(projectId)) {
        this.addLog(`Boot aborted: project switched during dev server start`);
        return;
      }
    } catch (e: any) {
      // プロジェクト切り替わり後に旧 boot がエラーを出しても無視する
      if (this._isOvertaken(projectId)) {
        return;
      }
      this.addLog(`Error: ${e.message || String(e)}`);
      this.setState({
        status: "error",
        error: e.message || String(e),
        url: null,
      });
    }
  }

  /**
   * ファイル同期 + 必要に応じてnpm installを実行する。
   * コード変更後に呼ばれる。
   *
   * 【重要】package.json の変更があった場合、以下の順序で処理する:
   *   1. package.json のみ先に同期
   *   2. npm install を実行（新パッケージをインストール）
   *   3. Dev Server を再起動（Vite のプリバンドルキャッシュをリセット）
   *   4. 残りの全ソースファイルを同期（Vite HMR が正常に動作）
   *
   * これにより「新しいパッケージをimportするコードが、未インストールのまま
   * Vite に読み込まれる」というタイミング問題を防ぐ。
   */
  async syncAndReload(projectId: string): Promise<void> {
    if (!this.container) {
      await this.boot(projectId);
      return;
    }

    // プロジェクトが変わっていたら再起動
    if (this.currentProjectId !== projectId) {
      await this.boot(projectId);
      return;
    }

    this.setState({ status: "syncing", error: null });
    this.addLog("Syncing project files...");

    try {
      // Phase 1: package.json の変更検出と先行同期
      this.addLog("Checking for package.json changes...");
      const pkgChanged = await detectPackageJsonChange(this.container, projectId);

      if (pkgChanged) {
        this.addLog("package.json changed, updating dependencies...");
        // package.json を先に書き込む
        const pkgContent = await readProjectFile(projectId, "package.json");
        if (pkgContent !== null) {
          await this.container.fs.writeFile("/package.json", pkgContent);
        }

        // npm install を実行（完全に完了するまで待つ）
        await this._runNpmInstall();
        this.addLog("Dependencies updated");
      }

      // Phase 2: 残りのソースファイルを同期
      const result = await syncChangedFiles(this.container, projectId);
      if (result.filesSynced > 0) {
        this.addLog(`Synced ${result.filesSynced} file(s) to container`);
      }
      if (result.errors.length > 0) {
        const errMsg = `Sync errors: ${result.errors.join('; ')}`;
        console.warn(`[preview] ${errMsg}`);
        this.setState({ error: errMsg });
      }

      // Phase 3: ★ 常に Dev Server を再起動
      this.addLog("Restarting dev server...");
      await this._startDevServer();
      this.addLog("Dev server ready");
    } catch (e: any) {
      console.error(`[preview] syncAndReload error:`, e);
      this.setState({
        status: "error",
        error: `[Preview Error] ${e.message || String(e)}`,
      });
    }
  }

  /**
   * npm install を実行する。
   * package.json の差分検出は呼び出し元で行う。
   */
  private async _runNpmInstall(): Promise<void> {
    if (!this.container) throw new Error("Container not booted");

    this.setState({ status: "installing" });

    const installProcess = await this.container.spawn("npm", ["install"]);

    // 出力を収集（デバッグ用・上限あり）
    let outputLines = 0;
    const outputChunks: string[] = [];
    const reader = installProcess.output.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (outputLines < INSTALL_OUTPUT_LIMIT) {
          outputChunks.push(value);
          outputLines++;
        }
      }
    } finally {
      reader.releaseLock();
    }

    const exitCode = await installProcess.exit;

    if (exitCode !== 0) {
      const log = outputChunks.join("").slice(0, 1000);
      throw new Error(`npm install failed (exit ${exitCode}):\n${log}`);
    }
  }

  /**
   * Vite dev server を起動する。
   * server-ready イベントを待つ（タイムアウト付き）。
   */
  private async _startDevServer(): Promise<void> {
    if (!this.container) throw new Error("Container not booted");

    // 既存のdevサーバーを停止
    if (this.devServerProcess) {
      this.devServerProcess.kill();
      this.devServerProcess = null;
    }

    this.setState({ status: "starting-dev" });

    // server-ready を待つPromise
    const serverReady = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Dev server did not start within ${SERVER_READY_TIMEOUT}ms`));
      }, SERVER_READY_TIMEOUT);

      const unsub = this.container!.on("server-ready", (_port, url) => {
        clearTimeout(timeout);
        unsub();
        resolve(url);
      });
    });

    // vite dev server 起動（package.json の dev スクリプトを使用）
    this.devServerProcess = await this.container.spawn("npm", ["run", "dev"]);

    // プロセスエラーハンドリング
    this.devServerProcess.exit.then((code) => {
      if (code !== 0 && this._status !== "idle") {
        console.warn(`[preview] Dev server exited with code ${code}`);
      }
    }).catch(() => {});

    // ★ Vite dev server の出力をキャプチャ開始（エラー検出用）
    this._startViteOutputCapture();

    const url = await serverReady;
    this.setState({ url, status: "ready" });
  }

  /**
   * OPFS の最新ファイルを WebContainer に同期する（package.json を除く）。
   * getErrors() から呼ばれ、tsc 実行前に最新のソースをコンテナに反映させる。
   *
   * 【注意】package.json は同期しない。
   * syncAndReload 内の detectPackageJsonChange + npm install に一元化するため。
   * ここで同期してしまうと、後続の syncAndReload が変更を検出できず
   * npm install がスキップされる。
   */
  async syncFiles(projectId: string): Promise<{ filesSynced: number; errors: string[] }> {
    if (!this.container) return { filesSynced: 0, errors: ['Container not booted'] };
    try {
      // OPFS から全ファイル一覧を取得
      const allFiles = await listProjectFiles(projectId);
      let filesSynced = 0;
      const errors: string[] = [];

      for (const file of allFiles) {
        if (file.isDirectory) continue;
        // package.json と lockfile はスキップ
        if (file.path === "package.json" || file.path === "package-lock.json") continue;
        if (file.path.startsWith("node_modules/")) continue;

        try {
          const content = await readProjectFile(projectId, file.path);
          if (content === null) continue;

          // コンテナ上の既存ファイルと比較（差分があれば書込み）
          let needsWrite = true;
          try {
            const existing = await this.container.fs.readFile("/" + file.path, "utf-8");
            needsWrite = existing !== content;
          } catch {
            // ファイルが存在しない → 書込み必要
          }

          if (needsWrite) {
            // ディレクトリがなければ作成
            const dirPath = "/" + file.path.split("/").slice(0, -1).join("/");
            if (dirPath !== "/") {
              try {
                await this.container.fs.mkdir(dirPath, { recursive: true });
              } catch { /* ignore */ }
            }
            await this.container.fs.writeFile("/" + file.path, content);
            filesSynced++;
          }
        } catch (e: any) {
          errors.push(`${file.path}: ${e.message || e}`);
        }
      }

      if (filesSynced > 0) {
        console.log(`[preview] syncFiles: synced ${filesSynced} files (package.json excluded)`);
      }
      return { filesSynced, errors };
    } catch (e: any) {
      console.warn('[preview] syncFiles error:', e);
      return { filesSynced: 0, errors: [e.message || String(e)] };
    }
  }

  /**
   * getErrors() 用のファイル同期。
   *
   * package.json が変更されているかチェックし、変更があれば npm install +
   * dev server 再起動まで行う（syncAndReload）。変更がなければソースファイル
   * のみを高速同期する（syncFiles）。
   *
   * これにより、get_errors() 実行時に Container の状態が最新であることが保証され、
   * Vite dev server 出力からのエラー検出（_getViteErrors）が正確になる。
   */
  async syncForErrors(projectId: string): Promise<void> {
    if (!this.container) {
      await this.boot(projectId);
      return;
    }

    if (this.currentProjectId !== projectId) {
      await this.boot(projectId);
      return;
    }

    // package.json の変更を検出（OPFS vs Container）
    const pkgChanged = await detectPackageJsonChange(this.container, projectId);

    if (pkgChanged) {
      // パッケージ変更あり → npm install + dev server 再起動（Vite 出力キャプチャも再開）
      this.addLog("Package.json changed — running full sync + npm install + reload...");
      await this.syncAndReload(projectId);
    } else {
      // ソースファイルのみの変更 → 高速同期（Vite HMR が差分を適用）
      const result = await this.syncFiles(projectId);
      if (result.filesSynced > 0) {
        this.addLog(`Synced ${result.filesSynced} file(s) before error check`);
      }
      if (result.errors.length > 0) {
        console.warn(`[preview] syncForErrors warnings: ${result.errors.join('; ')}`);
      }
    }
  }

  /**
   * 複合チェックを実行する（型チェック + 不足パッケージ検出 + Vite エラー検出）。
   * AI の get_errors() から呼ばれる。
   *
   * 戻り値の配列には以下の種類のエラーが含まれる:
   * - "typescript": tsc --noEmit による型エラー
   * - "missing-package": コード内で import されているが package.json にないパッケージ
   * - "vite": Vite dev server の出力から検出されたエラー（CSS パース、プラグイン、モジュール解決失敗など）
   */
  async checkProject(projectId: string): Promise<import("./types").ErrorEntry[]> {
    if (!this.container) return [];
    const errors: import("./types").ErrorEntry[] = [];
    this.addLog("Running type check (tsc --noEmit)...");

    // 1. TypeScript 型チェック
    try {
      const tscErrors = await this._runTscCheck();
      errors.push(...tscErrors);
    } catch (e: any) {
      errors.push({ type: "typescript", message: `Type check error: ${e.message}` });
    }

    // 2. 不足パッケージ検出
    try {
      const missingErrors = await this._detectMissingPackages(projectId);
      if (missingErrors.length > 0) {
        this.addLog(`Found ${missingErrors.length} missing package(s)`);
      }
      errors.push(...missingErrors);
    } catch (e: any) {
      console.warn("[preview] Package check error:", e.message);
    }

    // 3. Vite dev server エラー検出
    //    tsc では検出できない Vite 固有のエラー（CSS パース失敗、プラグインエラー、
    //    モジュール解決失敗など）を dev server の出力から抽出する。
    const viteErrors = this._getViteErrors();
    if (viteErrors.length > 0) {
      this.addLog(`Vite errors: ${viteErrors.length} detected from dev server output`);
    }
    errors.push(...viteErrors);

    const typeErrors = errors.filter(e => e.type === "typescript").length;
    const pkgErrors = errors.filter(e => e.type === "missing-package").length;
    const vErrors = errors.filter(e => e.type === "vite").length;
    if (errors.length > 0) {
      this.addLog(`Check complete: ${typeErrors} type error(s), ${pkgErrors} missing package(s), ${vErrors} Vite error(s)`);
    } else {
      this.addLog("Check complete: no errors found");
    }

    return errors;
  }

  /**
   * WebContainer内で npx tsc --noEmit を実行し、型エラーを収集する。
   */
  private async _runTscCheck(): Promise<import("./types").ErrorEntry[]> {
    if (!this.container) return [];

    const process = await this.container.spawn("npx", ["tsc", "--noEmit"]);

    let output = "";
    const reader = process.output.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += value;
      }
    } finally {
      reader.releaseLock();
    }

    const exitCode = await process.exit;
    if (exitCode === 0) return [];

    return parseTscOutput(output);
  }

  /**
   * 全ソースファイルの import 文を解析し、package.json に宣言されていない
   * パッケージを検出する。
   */
  private async _detectMissingPackages(projectId: string): Promise<import("./types").ErrorEntry[]> {
    if (!this.container) return [];

    // package.json を OPFS から読み込む（AI が apply_artifact で書き込んだ最新版）
    // コンテナから読まない理由: syncFiles は package.json を同期しないため、
    // コンテナには古いバージョンが残っている。
    // OPFS の最新版と比較することで、正しく不足パッケージを検出できる。
    let pkgJson: string | null;
    try {
      pkgJson = await readProjectFile(projectId, "package.json");
    } catch {
      pkgJson = null;
    }
    if (pkgJson === null) return [];

    let pkg: any;
    try {
      pkg = JSON.parse(pkgJson);
    } catch {
      return [];
    }

    const allDeps: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    // ソースファイル一覧を OPFS から取得（同期直後なのでコンテナと一致する）
    const files = await listProjectFiles(projectId);
    const missingPackages = new Map<string, Set<string>>();

    // import 文を抽出する正規表現
    //   import ... from "pkg"
    //   import("pkg")
    //   export ... from "pkg"
    const importRegex = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g;

    for (const file of files) {
      if (file.isDirectory) continue;
      // TypeScript/TSX ファイルのみチェック
      if (!file.path.endsWith(".ts") && !file.path.endsWith(".tsx")) continue;

      let content: string | null;
      try {
        content = await this.container.fs.readFile("/" + file.path, "utf-8");
      } catch {
        continue; // ファイルが読めなければスキップ
      }

      let match: RegExpExecArray | null;
      importRegex.lastIndex = 0; // 正規表現をリセット

      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];

        // 相対パス、絶対パス、プロジェクトエイリアスはスキップ
        if (importPath.startsWith(".") || importPath.startsWith("/")) continue;
        if (importPath.startsWith("@/") || importPath.startsWith("@/")) continue;

        // node: プレフィックスはスキップ
        if (importPath.startsWith("node:")) continue;

        // パッケージ名を抽出（@scope/name 形式に対応）
        const pkgName = importPath.startsWith("@")
          ? importPath.split("/").slice(0, 2).join("/")
          : importPath.split("/")[0];

        // 空文字列や明らかにパッケージでないものをスキップ
        if (!pkgName || pkgName === "") continue;

        if (!allDeps[pkgName] && pkgName !== "react" && pkgName !== "react-dom") {
          // react, react-dom は常に必要だが package.json にない可能性（テンプレートミス）
          // 実際にはテンプレートにあるのでここに来ることはほぼない
          if (!missingPackages.has(pkgName)) {
            missingPackages.set(pkgName, new Set());
          }
          missingPackages.get(pkgName)!.add(file.path);
        }
      }
    }

    const result: import("./types").ErrorEntry[] = [];
    for (const [pkgName, files] of missingPackages) {
      const fileList = [...files].join(", ");
      result.push({
        type: "missing-package",
        message: `Package "${pkgName}" is imported but not listed in package.json dependencies. Used in: ${fileList}. Use apply_artifact to add it to the "dependencies" field in package.json.`,
      });
    }

    return result;
  }

  // ── Vite Dev Server 出力キャプチャ ────────────────────────────────────

  /**
   * Vite dev server のプロセス出力の読み取りを開始する。
   * 出力をリングバッファに保存し、後で _getViteErrors() がエラーパターンを
   * スキャンできるようにする。
   */
  private _startViteOutputCapture(): void {
    // 既存のキャプチャを停止（前回のプロセスがまだ生きている可能性）
    this._readingViteOutput = false;
    if (this._viteOutputReader) {
      try { this._viteOutputReader.cancel(); } catch { /* ignore */ }
      this._viteOutputReader = null;
    }

    if (!this.devServerProcess) return;

    this._viteOutputBuffer = [];
    this._readingViteOutput = true;

    const reader = this.devServerProcess.output.getReader();
    this._viteOutputReader = reader;

    // バックグラウンドで出力を読み続ける（await しない）
    this._readViteOutputLoop(reader).catch(() => {
      this._readingViteOutput = false;
    });
  }

  /**
   * Vite dev server の出力を読み続けるループ。
   * _startViteOutputCapture からバックグラウンドで実行される。
   */
  private async _readViteOutputLoop(reader: ReadableStreamDefaultReader<string>): Promise<void> {
    try {
      while (this._readingViteOutput) {
        const { done, value } = await reader.read();
        if (done) break;

        // 改行で分割してリングバッファに追加
        const lines = value.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            this._viteOutputBuffer.push(trimmed);
          }
        }

        // バッファサイズを制限（古い行から削除）
        while (this._viteOutputBuffer.length > PreviewManager.MAX_VITE_OUTPUT_LINES) {
          this._viteOutputBuffer.shift();
        }
      }
    } catch {
      // プロセス終了またはキャンセル — 正常
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
      if (this._viteOutputReader === reader) {
        this._viteOutputReader = null;
      }
    }
  }

  /**
   * Vite dev server の出力を停止し、バッファをクリアする。
   */
  private _stopViteOutputCapture(): void {
    this._readingViteOutput = false;
    this._viteOutputBuffer = [];
    if (this._viteOutputReader) {
      try { this._viteOutputReader.cancel(); } catch { /* ignore */ }
      this._viteOutputReader = null;
    }
  }

  /**
   * キャプチャした Vite dev server 出力からエラー行を抽出する。
   *
   * Vite がエラーオーバーレイを表示するとき、必ずコンソールにエラー行を
   * 出力する。その出力をスキャンし、構造化エラーとして返す。
   *
   * 新しい行を優先してスキャンする（最新のエラーが最も関連性が高い）。
   * 最大5件まで返す。重複は除去する。
   */
  private _getViteErrors(): import("./types").ErrorEntry[] {
    if (this._viteOutputBuffer.length === 0) return [];

    const errors: import("./types").ErrorEntry[] = [];
    const seen = new Set<string>();

    // 新しい行を優先（逆順）
    const lines = this._viteOutputBuffer.slice().reverse();

    for (const line of lines) {
      if (errors.length >= 5) break;

      const matched = PreviewManager.VITE_ERROR_PATTERNS.some((p) => p.test(line));
      if (!matched) continue;

      // 重複除去（行の先頭80文字で判断）
      const dedupKey = line.slice(0, 80);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      errors.push({
        type: "vite",
        message: line.length > 300 ? line.slice(0, 300) + "…" : line,
      });
    }

    return errors;
  }

  // ── クリーンアップ ────────────────────────────────────────────────────

  /** WebContainer を破棄し、リソースを解放する。 */
  teardown(): void {
    if (this.unsubServerReady) {
      this.unsubServerReady();
      this.unsubServerReady = null;
    }
    if (this.unsubPort) {
      this.unsubPort();
      this.unsubPort = null;
    }
    if (this.devServerProcess) {
      try {
        this.devServerProcess.kill();
      } catch { /* ignore */ }
      this.devServerProcess = null;
    }
    if (this.container) {
      try {
        this.container.teardown();
      } catch { /* ignore */ }
      this.container = null;
    }

    // Vite 出力キャプチャのクリーンアップ
    this._stopViteOutputCapture();

    this.currentProjectId = null;
    this._url = null;
    this._error = null;
    this._status = "idle";
    this.notify();
  }
}

// ── tsc 出力パーサー ─────────────────────────────────────────────────────────

/**
 * tsc --noEmit の出力をパースして構造化エラーに変換する。
 *
 * 入力形式:
 *   src/App.tsx:5:10 - error TS2322: Type 'string' is not assignable to type 'number'.
 */
function parseTscOutput(output: string): import("./types").ErrorEntry[] {
  const entries: import("./types").ErrorEntry[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.trim() || line.startsWith(" ")) continue;

    // "file.ts(line,col): error TSxxxx: message"
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error\s+TS\d+:\s+.+)$/);
    if (match) {
      entries.push({
        type: "typescript",
        filePath: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        message: match[4].trim(),
      });
      continue;
    }

    // "file.ts:line:col - error TSxxxx: message"
    const match2 = line.match(/^(.+?):(\d+):(\d+)\s*-\s*(error\s+TS\d+:\s+.+)$/);
    if (match2) {
      entries.push({
        type: "typescript",
        filePath: match2[1].trim(),
        line: parseInt(match2[2], 10),
        column: parseInt(match2[3], 10),
        message: match2[4].trim(),
      });
      continue;
    }

    // Fallback: "file.ts(line,col): error ..."
    const match3 = line.match(/^error\s+(.+)$/);
    if (match3) {
      entries.push({
        type: "syntax",
        message: match3[1].trim(),
      });
    }
  }

  return entries;
}
