/**
 * Build the DeskSpawn sidecar into a standalone binary.
 *
 * Uses `bun build --compile` to create a native binary that bundles
 * the Bun runtime + all JS/TS dependencies. The binary is placed at
 * src-tauri/binaries/deskspawn-sidecar-<target-triple> for Tauri's
 * externalBin mechanism.
 *
 * In dev mode (when --dev flag is passed), the build is skipped if a
 * valid binary already exists, to keep `tauri dev` fast.
 */

import { execSync } from "child_process";
import { existsSync, renameSync } from "fs";

const isDev = process.argv.includes("--dev");
const targetTriple = execSync("rustc -vV | grep host | cut -d' ' -f2")
  .toString()
  .trim();

const binaryPath = `./src-tauri/binaries/deskspawn-sidecar-${targetTriple}`;

// In dev mode, skip rebuild if the binary already exists
if (isDev && existsSync(binaryPath)) {
  console.log(`[sidecar] Binary already exists: ${binaryPath}`);
  process.exit(0);
}

console.log(`[sidecar] Building binary for ${targetTriple}...`);

// Step 1: Compile with bun
execSync(
  "bun build --compile ./sidecar/src/server.ts --outfile ./src-tauri/binaries/deskspawn-sidecar",
  { stdio: "inherit", cwd: process.cwd() },
);

// Step 2: Rename to include target triple
const builtPath = "./src-tauri/binaries/deskspawn-sidecar";
if (existsSync(builtPath)) {
  renameSync(builtPath, binaryPath);
  console.log(`[sidecar] Binary created: ${binaryPath}`);
} else {
  console.error(`[sidecar] Build failed: ${builtPath} not found`);
  process.exit(1);
}
