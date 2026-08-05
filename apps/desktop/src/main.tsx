/**
 * DeskSpawn Desktop — Entry Point
 *
 * Uses the same CSS and same App component as the Web version.
 * Skips the landing page by forcing route to /app.
 * Platform services are registered before rendering.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerDesktopServices } from "./lib/services";
import { getSidecarPort } from "./lib/ipc";
// Import CSS (desktop entry imports web app's styles via local index.css)
import "./index.css";

// Register desktop services before anything renders
registerDesktopServices();

// デスクトップ環境フラグ — 共有エンジンがサイドカープロキシ経由でAIを呼ぶための判定
(window as unknown as { __DESKSPAWN_DESKTOP__?: boolean }).__DESKSPAWN_DESKTOP__ = true;

// Force desktop to always land in app mode
localStorage.setItem("deskspawn_route", "/app");

/**
 * サイドカーの実ポートをRustから取得してからレンダーする。
 * WSL2 の localhostForwarding がゾンビ共有ソケットを残す環境では、
 * サイドカーは起動のたびにフォールバックしてポートが変わるため、
 * 共有コード（models-fetcher / providers / preview）は
 * window.__DESKSPAWN_SIDECAR_PORT__ 経由で実ポートに接続する。
 */
async function bootstrap() {
  const port = await getSidecarPort().catch(() => 3009);
  (window as unknown as { __DESKSPAWN_SIDECAR_PORT__?: number }).__DESKSPAWN_SIDECAR_PORT__ = port;

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
