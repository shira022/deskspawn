/**
 * Browser compatibility checker for DeskSpawn Web.
 *
 * Runs on startup to verify the browser supports required features.
 * Shows a blocking error if any critical feature is missing.
 *
 * WebContainer 対応:
 * - crossOriginIsolation: WebContainer の SharedArrayBuffer 必須
 * - ServiceWorker: WebContainer の基盤として必要
 * - IndexedDB: 永続ストレージに必要
 * - Web Crypto: API キー暗号化に必要
 */

export interface CompatResult {
  ok: boolean;
  indexedDB: boolean;
  crossOriginIsolated: boolean;
  crypto: boolean;
  errors: string[];
}

export async function checkCompatibility(): Promise<CompatResult> {
  const errors: string[] = [];
  const result: CompatResult = {
    ok: true,
    indexedDB: false,
    crossOriginIsolated: false,
    crypto: false,
    errors,
  };

  // ── IndexedDB ──────────────────────────────────────────────────────
  if (typeof indexedDB !== "undefined" && indexedDB) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("__deskspawn_compat_check", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("_test")) {
            db.createObjectStore("_test");
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.close();
          indexedDB.deleteDatabase("__deskspawn_compat_check");
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      result.indexedDB = true;
    } catch {
      errors.push("IndexedDB is not available (may be blocked in private browsing mode).");
    }
  } else {
    errors.push("IndexedDB is not supported by this browser.");
  }

  // ── Cross-Origin Isolation (WebContainer 必須) ─────────────────────
  // WebContainer は SharedArrayBuffer を使用するため、crossOriginIsolation が必要。
  // COOP/COEP ヘッダーが正しく設定されていれば true になる。
  if (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated) {
    result.crossOriginIsolated = true;
  } else {
    errors.push(
      "Cross-Origin Isolation is required for WebContainer (preview). " +
      "The server must send Cross-Origin-Opener-Policy: same-origin and " +
      "Cross-Origin-Embedder-Policy: require-corp headers. " +
      "This is typically required only once when starting the dev server.",
    );
  }

  // ── Web Crypto ─────────────────────────────────────────────────────
  if (typeof crypto !== "undefined" && crypto && crypto.subtle) {
    result.crypto = true;
  } else {
    errors.push("Web Crypto API is not available (required for secure key storage).");
  }

  // crossOriginIsolation が無いと WebContainer が動かないが、
  // dev サーバーのヘッダー設定で修正可能なため critical にはしない。
  result.ok = result.indexedDB && result.crypto;
  return result;
}

/**
 * Returns a user-friendly error message for compatibility failures.
 */
export function getCompatErrorMessage(result: CompatResult): string {
  if (result.ok) return "";
  const lines: string[] = [
    "⚠️ DeskSpawn requires a modern browser with the following features:\n",
  ];
  if (!result.indexedDB) {
    lines.push("• IndexedDB — Required for data storage. Try disabling private browsing or switch to Chrome/Edge/Firefox.");
  }
  if (!result.crossOriginIsolated) {
    lines.push("• Cross-Origin Isolation — Required for the preview system. The dev server must be started with the correct HTTP headers.");
  }
  if (!result.crypto) {
    lines.push("• Web Crypto API — Required for secure API key storage. Please update your browser.");
  }
  lines.push("\nRecommended browsers: Chrome 105+, Edge 105+");
  return lines.join("\n");
}
