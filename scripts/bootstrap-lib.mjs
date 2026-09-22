/**
 * DeskSpawn — pure helpers shared by the bootstrap scripts.
 *
 * scripts/bootstrap.sh (Linux/macOS) and scripts/bootstrap.ps1 (Windows) cannot
 * import JavaScript, so they mirror the small decision rules implemented here.
 * This module is the single unit-tested reference for those rules: keep it and
 * the shell scripts in sync (see scripts/bootstrap.test.mjs).
 *
 * Everything in this file is pure and offline: no filesystem, network, or
 * process access. This makes it safe to unit test on any host.
 */

/** Default branch/tag to check out. */
export const DEFAULT_REF = 'main';

/** Directory name (under $HOME) used when running outside a checkout. */
export const DEFAULT_CLONE_DIR_NAME = 'deskspawn-src';

/** Bun version pinned across CI and the bootstrap scripts. */
export const PINNED_BUN = '1.3.14';

/** Minimum supported Node.js major version (repo engines require >= 20). */
export const MIN_NODE_MAJOR = 20;

/** Minimum supported Bun version. */
export const MIN_BUN = '1.3.0';

/**
 * Relative path (from the repo root) of the desktop frontend dist produced by
 * `pnpm --filter desktop build`. The Tauri config points `frontendDist` at
 * `apps/desktop/src-tauri/../dist`, i.e. this directory.
 */
export const DESKTOP_DIST_RELATIVE_PATH = 'apps/desktop/dist';

/**
 * Fallback filename (inside `apps/desktop/src-tauri`) for the build override
 * used when pnpm is unavailable. The scripts prefer a temp location and only
 * fall back to this in-repo path if needed, deleting it after the build.
 */
export const BUILD_OVERRIDE_FILE_NAME = '.bootstrap-build-override.json';

/**
 * JSON merge patch that blanks the Tauri `beforeBuildCommand` (which shells out
 * to pnpm) so a host with cargo but no pnpm can build an already-built frontend.
 */
export const BUILD_OVERRIDE_JSON = '{"build":{"beforeBuildCommand":""}}';

/** Native packages the Linux Tauri build needs (apt names). */
export const LINUX_APT_PACKAGES = [
  'build-essential',
  'pkg-config',
  'libssl-dev',
  'libwebkit2gtk-4.1-dev',
  'libgtk-3-dev',
  'libsoup-3.0-dev',
  'libjavascriptcoregtk-4.1-dev',
  'libappindicator3-dev',
  'librsvg2-dev',
  'patchelf',
];

/** Toolchain prerequisites and the minimum version each must satisfy. */
export const TOOL_REQUIREMENTS = [
  { name: 'git', minVersion: null },
  { name: 'node', minVersion: `${MIN_NODE_MAJOR}.0.0` },
  { name: 'pnpm', minVersion: null },
  { name: 'bun', minVersion: MIN_BUN },
  { name: 'rustc', minVersion: null },
  { name: 'cargo', minVersion: null },
];

/**
 * Parse and validate a `--ref` value (branch or tag).
 *
 * @param {string} raw
 * @returns {string} the trimmed ref
 * @throws {Error} when the ref is empty or contains unsafe characters
 */
export function normalizeRef(raw) {
  const ref = typeof raw === 'string' ? raw.trim() : '';
  if (!ref) throw new Error('--ref must not be empty');
  if (ref.startsWith('-')) throw new Error(`--ref must not start with "-": ${ref}`);
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f]/.test(ref)) throw new Error(`--ref contains whitespace or control characters: ${ref}`);
  if (ref.includes('..') || ref.includes('\\') || ref.includes(' ')) {
    throw new Error(`--ref contains an unsupported sequence: ${ref}`);
  }
  return ref;
}

/**
 * Parse the bootstrap command-line arguments.
 *
 * @param {string[]} argv arguments WITHOUT the leading `node script` entries
 * @returns {{ref: string, dir: (string|null), noBundle: boolean, dev: boolean, skipDeps: boolean, help: boolean}}
 * @throws {Error} on unknown options or missing option values
 */
export function parseBootstrapArgs(argv = []) {
  const options = {
    ref: DEFAULT_REF,
    dir: null,
    noBundle: false,
    dev: false,
    skipDeps: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    let inline;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq !== -1) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }

    const takeValue = (flag) => {
      if (inline !== undefined) return inline;
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Option ${flag} requires a value`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case '--ref':
        options.ref = takeValue('--ref');
        break;
      case '--dir':
        options.dir = takeValue('--dir');
        break;
      case '--no-bundle':
        options.noBundle = true;
        break;
      case '--dev':
        options.dev = true;
        break;
      case '--skip-deps':
        options.skipDeps = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${argv[i]}`);
    }
  }

  options.ref = normalizeRef(options.ref);
  return options;
}

/**
 * Parse a SemVer-ish version string into numeric components.
 * Accepts an optional leading `v` and ignores pre-release/build metadata.
 *
 * @param {unknown} value
 * @returns {{major: number, minor: number, patch: number}|null}
 */
export function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Compare two parsed SemVer objects: -1, 0 or 1. */
export function compareSemver(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}

/**
 * Whether `actual` satisfies the minimum version `min`.
 * Returns false when either version cannot be parsed.
 */
export function meetsMinVersion(actual, min) {
  const a = parseSemver(actual);
  const b = parseSemver(min);
  if (!a || !b) return false;
  return compareSemver(a, b) >= 0;
}

/**
 * Decide which tools are missing or outdated.
 *
 * @param {Record<string, string|{present?: boolean, version?: string}|null|undefined>} detected
 *   map of tool name -> version string, or `{present, version}`, or `null`/`undefined`
 * @param {Array<{name: string, minVersion: string|null}>} requirements
 * @returns {{satisfied: string[], missing: string[], outdated: Array<{name: string, found: string, required: string}>, ok: boolean}}
 */
export function evaluateTools(detected = {}, requirements = TOOL_REQUIREMENTS) {
  const satisfied = [];
  const missing = [];
  const outdated = [];

  for (const requirement of requirements) {
    const entry = detected[requirement.name];
    const present = entry !== null && entry !== undefined && entry !== false && entry.present !== false;
    if (!present) {
      missing.push(requirement.name);
      continue;
    }
    const version = typeof entry === 'string' ? entry : entry.version;
    if (requirement.minVersion && version && !meetsMinVersion(version, requirement.minVersion)) {
      outdated.push({ name: requirement.name, found: String(version), required: requirement.minVersion });
    } else {
      satisfied.push(requirement.name);
    }
  }

  return { satisfied, missing, outdated, ok: missing.length === 0 && outdated.length === 0 };
}

/**
 * Return which apt packages are not installed yet.
 *
 * @param {string[]} installedPackages package names reported as installed
 * @param {string[]} required
 * @returns {string[]}
 */
export function missingPackages(installedPackages = [], required = LINUX_APT_PACKAGES) {
  const installed = new Set(installedPackages);
  return required.filter((name) => !installed.has(name));
}

/**
 * Decide where the repository lives.
 *
 * @param {{cwd: string, isCheckout: boolean, requestedDir?: (string|null), home: string}} input
 * @returns {string}
 */
export function resolveRepoDir({ cwd, isCheckout, requestedDir = null, home }) {
  if (isCheckout) return cwd;
  if (requestedDir) return requestedDir;
  return `${home.replace(/\/+$/, '')}/${DEFAULT_CLONE_DIR_NAME}`;
}

/**
 * Bundle output directories relative to the repo root, per platform.
 *
 * @param {'win32'|'linux'|'darwin'|string} platform value of `process.platform`
 * @returns {string[]}
 */
export function bundleArtifactDirs(platform) {
  const base = 'apps/desktop/src-tauri/target/release/bundle';
  switch (platform) {
    case 'win32':
      return [`${base}/msi`, `${base}/nsis`];
    case 'darwin':
      return [`${base}/dmg`, `${base}/macos`];
    case 'linux':
    default:
      return [`${base}/deb`, `${base}/rpm`, `${base}/appimage`];
  }
}

/**
 * Decide which route can build the desktop app on this host.
 *
 * The Tauri config's `beforeBuildCommand` shells out to `pnpm`, so a machine
 * with cargo but no pnpm can only build when the frontend dist already exists;
 * in that case the scripts run `cargo tauri build` with a config override that
 * blanks `beforeBuildCommand`.
 *
 * Both scripts mirror this rule because they must run before Node.js exists.
 * Keep them in sync with this function (see scripts/bootstrap.test.mjs).
 *
 * @param {{pnpm?: boolean, cargo?: boolean, frontendDist?: boolean}} input
 *   `pnpm`/`cargo`: whether each tool is available on PATH.
 *   `frontendDist`: whether the pre-built frontend dist already exists.
 * @returns {{path: 'pnpm'|'cargo-override'|'impossible', reason: string}}
 */
export function decideBuildPath({ pnpm = false, cargo = false, frontendDist = false } = {}) {
  if (pnpm) {
    return {
      path: 'pnpm',
      reason: 'pnpm is available: it installs deps, builds the frontend dist, and drives the Tauri CLI.',
    };
  }
  if (cargo && frontendDist) {
    return {
      path: 'cargo-override',
      reason:
        'pnpm is unavailable but cargo and a pre-built frontend dist are present: using `cargo tauri build` with the beforeBuildCommand override.',
    };
  }
  if (cargo) {
    return {
      path: 'impossible',
      reason:
        `pnpm is unavailable and the frontend dist (${DESKTOP_DIST_RELATIVE_PATH}) is missing. ` +
        'Build the frontend on a machine with Node+pnpm (`pnpm --filter desktop build`) and copy it here, ' +
        'or install Node+pnpm (`corepack enable`) and re-run.',
    };
  }
  return {
    path: 'impossible',
    reason:
      'Neither pnpm nor cargo is available. Install Node+pnpm (https://pnpm.io/installation) ' +
      'or the Rust toolchain (https://rustup.rs), then re-run.',
  };
}
