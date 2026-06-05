/**
 * Build the DeskSpawn sidecar into a standalone binary.
 *
 * Uses `bun build --compile` to create a native binary that bundles
 * the Bun runtime + all JS/TS dependencies. The binary is placed at
 * src-tauri/binaries/deskspawn-sidecar-<target-triple> for Tauri's
 * externalBin mechanism.
 *
 * In dev mode (when --dev flag is passed), the build is skipped if a
 * valid binary already exists and is newer than the sidecar source files,
 * to keep `tauri dev` fast.
 */

import { execSync } from "child_process";
import { existsSync, renameSync, statSync } from "fs";
import { resolve } from "path";

const isDev = process.argv.includes("--dev");

// ── Prerequisite checks (cross-platform) ────────────────────────────

// Check that bun is available
try {
  execSync("bun --version", { stdio: "pipe" });
} catch {
  console.error("[sidecar] bun is required but not found on PATH. Install it: brew install bun");
  process.exit(1);
}

// Get target triple using rustc (cross-platform: parse output with Node)
let targetTriple;
try {
  const rustcOutput = execSync("rustc -vV", { encoding: "utf-8" });
  const hostLine = rustcOutput.split("\n").find((l) => l.startsWith("host:"));
  targetTriple = hostLine ? hostLine.split(" ")[1]?.trim() : null;
  if (!targetTriple) throw new Error("Could not parse host from rustc output");
} catch (e) {
  console.error("[sidecar] Failed to determine target triple:", e.message);
  process.exit(1);
}

const binaryPath = resolve(`src-tauri/binaries/deskspawn-sidecar-${targetTriple}`);

// ── Dev mode: skip rebuild if binary is up to date ──────────────────

if (isDev && existsSync(binaryPath)) {
  // Check if binary is newer than all sidecar source files
  const sidecarSources = [
    "sidecar/src/server.ts",
    "sidecar/src/screenshot.ts",
    "sidecar/src/tool-executors.ts",
    "sidecar/src/providers.ts",
    "sidecar/src/orchestrator.ts",
    "sidecar/src/agent.ts",
  ];
  const binMtime = statSync(binaryPath).mtimeMs;
  const anyStale = sidecarSources.some((srcPath) => {
    const fullPath = resolve(srcPath);
    if (!existsSync(fullPath)) return false;
    return statSync(fullPath).mtimeMs > binMtime;
  });
  if (!anyStale) {
    console.log(`[sidecar] Binary up to date: ${binaryPath}`);
    process.exit(0);
  }
  console.log(`[sidecar] Source files changed, rebuilding...`);
}

// ── Build fresh binary ──────────────────────────────────────────────

console.log(`[sidecar] Building binary for ${targetTriple}...`);

execSync(
  "bun build --compile ./sidecar/src/server.ts --outfile ./src-tauri/binaries/deskspawn-sidecar",
  { stdio: "inherit", cwd: process.cwd() },
);

const builtPath = resolve("./src-tauri/binaries/deskspawn-sidecar");
if (existsSync(builtPath)) {
  renameSync(builtPath, binaryPath);
  console.log(`[sidecar] Binary created: ${binaryPath}`);
} else {
  console.error(`[sidecar] Build failed: ${builtPath} not found`);
  process.exit(1);
}
