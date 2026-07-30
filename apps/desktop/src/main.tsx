/**
 * DeskSpawn Desktop — Entry Point
 *
 * Boot sequence:
 *   1. Render the Desktop App component (same UI as Web app)
 *   2. Platform services are registered in App.tsx
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
// Import the web app's CSS (same styles as the web version)
import "../../apps/web/src/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
