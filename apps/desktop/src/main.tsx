/**
 * DeskSpawn Desktop — Entry Point
 *
 * Boot sequence:
 *   1. Initialize Tauri (detect platform)
 *   2. Render the Desktop App component
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

function DesktopBoot(): React.ReactElement {
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DesktopBoot />
  </React.StrictMode>,
);
