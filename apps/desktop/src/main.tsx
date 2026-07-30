/**
 * DeskSpawn Desktop — Entry Point
 *
 * Boot sequence:
 *   1. Register Desktop platform services
 *   2. Initialize Tauri
 *   3. Render the Desktop App component
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
