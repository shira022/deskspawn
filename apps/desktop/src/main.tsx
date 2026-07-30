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
// Import CSS (desktop entry imports web app's styles via local index.css)
import "./index.css";

// Register desktop services before anything renders
registerDesktopServices();

// Force desktop to always land in app mode
localStorage.setItem("deskspawn_route", "/app");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
