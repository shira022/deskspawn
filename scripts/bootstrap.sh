#!/usr/bin/env bash
#
# DeskSpawn bootstrap (Linux / macOS)
# ====================================
#
# Idempotent: safe to run repeatedly; already-satisfied steps are skipped.
# It detects (and where possible installs) the toolchain needed to build the
# DeskSpawn desktop app, clones or updates the repository, installs workspace
# dependencies, builds the bun sidecar + frontend, and optionally bundles the
# installers.
#
# Usage:
#   scripts/bootstrap.sh [--ref <branch|tag>] [--dir <path>] [--no-bundle] [--dev] [--skip-deps]
#
#   --ref <branch|tag>  Git ref to check out (default: main)
#   --dir <path>        Where to clone when not already inside a checkout
#                       (default: ~/deskspawn-src)
#   --no-bundle         Fast build only (tauri build --no-bundle), no installers
#   --dev               Prepare everything, then print the `tauri dev` command
#   --skip-deps         Do not detect/install prerequisites (CI/advanced use)
#
# Build paths (host may have no Node/pnpm at all):
#   - "using pnpm": pnpm is on PATH. It installs deps, builds the frontend dist
#     (pnpm --filter desktop build) and drives the Tauri CLI.
#   - "using cargo-tauri override": pnpm is absent but cargo is present AND the
#     frontend dist is already built. The Tauri config's beforeBuildCommand
#     shells out to pnpm, so we pass a --config override that blanks it and run
#     `cargo tauri build` directly from apps/desktop/src-tauri.
#     This path also needs the Tauri CLI (`cargo tauri`), which rustup does NOT
#     install; if it is missing the script installs it with
#     `cargo install tauri-cli --locked` (compiles from source: several minutes
#     and a few hundred MB of disk) before building.
#     The frontend dist (apps/desktop/dist) MUST be pre-built; the script fails
#     with an actionable message instead of pretending to build it.
#   - "impossible": neither route is viable; the script exits with instructions.
#
# Never touches the app data root (~/deskspawn/); it only works inside the
# source checkout and, on a fresh machine, clones into the chosen directory.
#
# NOTE: The pure decision helpers (ref parsing, version comparison, missing
# prerequisite evaluation, build-path selection) are unit-tested in
# scripts/bootstrap-lib.mjs (see scripts/bootstrap.test.mjs). This script
# mirrors those rules because it must be able to run before Node.js exists.
# Keep both in sync.

set -euo pipefail

REF="main"
DIR=""
NO_BUNDLE=0
DEV_MODE=0
SKIP_DEPS=0

# Set by detect_build_path(): 'pnpm' or 'cargo-override'.
BUILD_PATH=""
# Temp dir holding the beforeBuildCommand override; removed on exit.
BUILD_OVERRIDE_DIR=""
cleanup() {
  if [ -n "$BUILD_OVERRIDE_DIR" ]; then rm -rf "$BUILD_OVERRIDE_DIR"; fi
  return 0
}
trap cleanup EXIT

MIN_NODE="20.0.0"
MIN_BUN="1.3.0"
PINNED_BUN="1.3.14"

# Mirrors scripts/bootstrap-lib.mjs (keep in sync).
DESKTOP_DIST_RELATIVE_PATH="apps/desktop/dist"
BUILD_OVERRIDE_FILE_NAME=".bootstrap-build-override.json"
BUILD_OVERRIDE_JSON='{"build":{"beforeBuildCommand":""}}'
# `cargo tauri` is the `tauri-cli` cargo subcommand; rustup does not install it.
TAURI_CLI_INSTALL_COMMAND="cargo install tauri-cli --locked"

LINUX_APT_PACKAGES=(
  build-essential
  pkg-config
  libssl-dev
  libwebkit2gtk-4.1-dev
  libgtk-3-dev
  libsoup-3.0-dev
  libjavascriptcoregtk-4.1-dev
  libappindicator3-dev
  librsvg2-dev
  patchelf
)

log() { printf '%s\n' "[bootstrap] $*"; }
warn() { printf '%s\n' "[bootstrap] WARNING: $*" >&2; }
die() { printf '%s\n' "[bootstrap] ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
DeskSpawn bootstrap (Linux / macOS)

Usage:
  scripts/bootstrap.sh [--ref <branch|tag>] [--dir <path>] [--no-bundle] [--dev] [--skip-deps]

  --ref <branch|tag>  Git ref to check out (default: main)
  --dir <path>        Where to clone when not already inside a checkout
                      (default: ~/deskspawn-src)
  --no-bundle         Fast build only (tauri build --no-bundle), no installers
  --dev               Prepare everything, then print the `tauri dev` command
  --skip-deps         Do not detect/install prerequisites (CI/advanced use)
EOF
}

have() { command -v "$1" >/dev/null 2>&1; }

# tauri_cli_available — is the `tauri-cli` cargo subcommand installed?
# `cargo tauri` is a subcommand crate, not part of rustup, so it must be
# checked separately from cargo.
tauri_cli_available() {
  command -v cargo-tauri >/dev/null 2>&1 && return 0
  cargo tauri --version >/dev/null 2>&1
}

# Mirror of scripts/bootstrap-lib.mjs normalizeRef(). Keep the reject/accept
# sets identical; the tests execute this function and compare it with the lib.
# Rejects: empty, leading '-', whitespace/control characters, '..', backslash.
validate_ref() {
  local ref="$1"
  case "$ref" in
    '') die "--ref must not be empty" ;;
    -*) die "--ref must not start with '-': $ref" ;;
  esac
  case "$ref" in
    *[[:space:]]*|*[[:cntrl:]]*) die "--ref contains whitespace or control characters: $ref" ;;
  esac
  case "$ref" in
    *..*|*\\*) die "--ref contains an unsupported sequence: $ref" ;;
  esac
}

# version_ge <actual> <minimum> — numeric dotted comparison, portable to BSD sort.
version_ge() {
  local actual minimum
  actual=$(printf '%s' "$1" | sed 's/^[^0-9]*//' | sed 's/[^0-9.].*$//')
  minimum=$(printf '%s' "$2" | sed 's/^[^0-9]*//' | sed 's/[^0-9.].*$//')
  [ -n "$actual" ] || return 1
  [ "$actual" = "$minimum" ] && return 0
  [ "$(printf '%s\n%s\n' "$actual" "$minimum" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" = "$minimum" ]
}

# ── Argument parsing ────────────────────────────────────────────────

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:?--ref requires a value}"; shift 2 ;;
    --ref=*) REF="${1#--ref=}"; shift ;;
    --dir) DIR="${2:?--dir requires a value}"; shift 2 ;;
    --dir=*) DIR="${1#--dir=}"; shift ;;
    --no-bundle) NO_BUNDLE=1; shift ;;
    --dev) DEV_MODE=1; shift ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

validate_ref "$REF"

# ── OS / privilege detection ────────────────────────────────────────

case "$(uname -s)" in
  Linux) OS="Linux" ;;
  Darwin) OS="Darwin" ;;
  *) die "Unsupported OS: $(uname -s). On Windows use scripts/bootstrap.ps1." ;;
esac

SUDO_CMD=""
if [ "$(id -u)" -eq 0 ]; then
  SUDO_CMD=""
elif sudo -n true 2>/dev/null; then
  SUDO_CMD="sudo"
fi

# Non-interactive sudo only: never hang waiting for a password prompt.
sudo_ok() { [ "$(id -u)" -eq 0 ] || sudo -n true 2>/dev/null; }

apt_install() {
  local pkgs=("$@")
  [ "${#pkgs[@]}" -gt 0 ] || return 0
  if ! have apt-get; then
    warn "apt-get unavailable. Install manually: ${pkgs[*]}"
    return 1
  fi
  if ! sudo_ok; then
    warn "No passwordless sudo; refusing to prompt. Install manually:"
    warn "  sudo apt-get update && sudo apt-get install -y ${pkgs[*]}"
    return 1
  fi
  log "Installing system packages (~250 MB disk): ${pkgs[*]}"
  ${SUDO_CMD} apt-get update
  ${SUDO_CMD} apt-get install -y "${pkgs[@]}"
}

# ── Prerequisite installation ───────────────────────────────────────

ensure_git() {
  if have git; then log "git found: $(git --version)"; return 0; fi
  log "git is missing; attempting to install it (~50 MB disk)."
  case "$OS" in
    Linux) apt_install git || die "git is required. Install it, then re-run." ;;
    Darwin)
      if have brew; then log "Installing git via Homebrew."; brew install git;
      else die "Install git (e.g. 'xcode-select --install') then re-run."; fi ;;
  esac
  have git || die "git still unavailable after install."
}

ensure_node() {
  if have node && version_ge "$(node --version)" "$MIN_NODE"; then
    log "node found: $(node --version)"; return 0
  fi
  if have node; then
    warn "node $(node --version) is older than $MIN_NODE; attempting upgrade."
  else
    log "node is missing; attempting to install Node.js 22 (~120 MB disk)."
  fi
  # Best-effort: Node+pnpm are only needed for the pnpm build path. If this
  # cannot be installed, fall through so detect_build_path() can choose the
  # cargo-tauri override path (or fail with a combined, actionable message).
  case "$OS" in
    Linux)
      if sudo_ok && have apt-get && have curl; then
        log "Installing Node.js 22 from NodeSource."
        curl -fsSL https://deb.nodesource.com/setup_22.x | ${SUDO_CMD} bash - || warn "NodeSource setup failed."
        ${SUDO_CMD} apt-get install -y nodejs || warn "apt-get install nodejs failed."
      else
        warn "Cannot install Node.js automatically (need apt-get + curl + passwordless sudo)."
      fi ;;
    Darwin)
      if have brew; then
        log "Installing node@22 via Homebrew."
        brew install node@22 || warn "brew install node@22 failed."
        # node@22 is keg-only: Homebrew does NOT link it into /opt/homebrew/bin,
        # so `node` stays unavailable unless we add its bin dir to PATH.
        local brew_node_prefix
        brew_node_prefix="$(brew --prefix node@22 2>/dev/null || true)"
        if [ -n "$brew_node_prefix" ] && [ -d "$brew_node_prefix/bin" ]; then
          export PATH="$brew_node_prefix/bin:$PATH"
        else
          warn "Could not resolve the node@22 Homebrew prefix; add it to PATH manually."
        fi
      else
        warn "Homebrew is unavailable; cannot install Node.js automatically."
      fi ;;
  esac
  if have node && version_ge "$(node --version)" "$MIN_NODE"; then
    log "node ready: $(node --version)"; return 0
  fi
  warn "Node.js >= $MIN_NODE is unavailable. Install it (https://nodejs.org) for the pnpm path;"
  warn "the cargo-tauri override path can proceed without it if the frontend dist is pre-built."
  return 0
}

ensure_pnpm() {
  if have pnpm; then log "pnpm found: $(pnpm --version)"; return 0; fi
  if have corepack; then
    log "Enabling pnpm via corepack (bundled with Node; no extra download)."
    corepack enable 2>/dev/null || corepack enable --install-directory "${HOME}/.local/bin" 2>/dev/null || true
    export PATH="${HOME}/.local/bin:${PATH}"
  fi
  if have pnpm; then log "pnpm enabled: $(pnpm --version)"; return 0; fi
  warn "pnpm is unavailable and could not be enabled via corepack."
  warn "Falling back to the cargo-tauri override path (requires a pre-built frontend dist)."
  return 0
}

ensure_bun() {
  if have bun && version_ge "$(bun --version)" "$MIN_BUN"; then
    log "bun found: $(bun --version)"; return 0
  fi
  if have bun; then warn "bun $(bun --version) is older than $MIN_BUN; installing v$PINNED_BUN."; fi
  have curl || die "curl is required to install bun (https://bun.sh/docs/installation)."
  log "Installing bun v$PINNED_BUN (~90 MB disk, to ${BUN_INSTALL:-$HOME/.bun})."
  curl -fsSL https://bun.sh/install | bash -s "bun-v$PINNED_BUN"
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  have bun && version_ge "$(bun --version)" "$MIN_BUN" || die "bun installation failed; install from https://bun.sh then re-run."
}

ensure_rust() {
  if have rustc && have cargo; then
    log "rustc found: $(rustc --version)"; return 0
  fi
  have curl || die "curl is required to install rustup (https://rustup.rs)."
  log "Installing Rust via rustup (minimal profile, ~300 MB disk, to ${CARGO_HOME:-$HOME/.cargo})."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  # shellcheck disable=SC1090
  [ -f "${HOME}/.cargo/env" ] && . "${HOME}/.cargo/env"
  have rustc && have cargo || die "Rust installation failed; install from https://rustup.rs then re-run."
}

ensure_linux_deps() {
  [ "$OS" = "Linux" ] || return 0
  if ! have apt-get || ! have dpkg; then
    warn "Non-apt Linux detected; ensure these are present: ${LINUX_APT_PACKAGES[*]}"
    return 0
  fi
  local missing=() pkg
  for pkg in "${LINUX_APT_PACKAGES[@]}"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then missing+=("$pkg"); fi
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    log "All Linux build dependencies are installed."
    return 0
  fi
  apt_install "${missing[@]}" || warn "Some Linux build dependencies are missing; the build may fail."
}

# ── Repository resolution / clone / update ──────────────────────────

is_inside_checkout() {
  [ -f "$1/apps/desktop/src-tauri/tauri.conf.json" ] && git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

expand_home() {
  case "$1" in
    '~') printf '%s' "$HOME" ;;
    '~/'*) printf '%s/%s' "$HOME" "${1#\~/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

resolve_repo() {
  if is_inside_checkout "$PWD"; then
    REPO_DIR="$PWD"
    log "Running inside an existing checkout: $REPO_DIR"
    return 0
  fi
  if [ -n "$DIR" ]; then
    REPO_DIR="$(expand_home "$DIR")"
  else
    REPO_DIR="$HOME/deskspawn-src"
  fi
}

sync_repo() {
  local url="${DESKSPAWN_REPO_URL:-https://github.com/shira022/deskspawn.git}"
  if git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    log "Updating existing clone at $REPO_DIR (ref: $REF)."
    git -C "$REPO_DIR" fetch --depth 1 origin "$REF"
    git -C "$REPO_DIR" checkout "$REF"
    # Do NOT swallow this failure: a non-fast-forward or conflicting pull would
    # otherwise leave a stale/divergent tree that gets built silently.
    if ! git -C "$REPO_DIR" pull --ff-only origin "$REF"; then
      local current_head
      current_head="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
      die "git pull --ff-only failed for ref '$REF' at commit $current_head. The local checkout has diverged from origin/$REF; resolve it manually (e.g. reset or merge) and re-run."
    fi
  else
    if [ -e "$REPO_DIR" ] && [ -n "$(ls -A "$REPO_DIR" 2>/dev/null || true)" ]; then
      die "Directory $REPO_DIR exists and is not a DeskSpawn checkout. Choose another --dir."
    fi
    mkdir -p "$(dirname "$REPO_DIR")"
    log "Cloning $url (ref: $REF) into $REPO_DIR (~200 MB disk)."
    git clone --depth 1 --branch "$REF" "$url" "$REPO_DIR"
  fi
}

# ── Build ───────────────────────────────────────────────────────────

frontend_dist_exists() {
  [ -f "$REPO_DIR/$DESKTOP_DIST_RELATIVE_PATH/index.html" ]
}

# Decide (and log) which build route to use. Mirrors decideBuildPath() in
# scripts/bootstrap-lib.mjs; keep the two in sync. Sets BUILD_PATH to 'pnpm',
# 'cargo-override' or 'install-tauri-cli', or dies when the route is
# 'impossible'.
detect_build_path() {
  if have pnpm; then
    BUILD_PATH="pnpm"
    log "Build path: using pnpm (installs deps, builds the frontend dist, drives the Tauri CLI)."
    return 0
  fi
  if have cargo && frontend_dist_exists; then
    if tauri_cli_available; then
      BUILD_PATH="cargo-override"
      log "Build path: using cargo-tauri override (pnpm not found; reusing the pre-built frontend dist)."
      return 0
    fi
    # cargo + pre-built dist are present, but `cargo tauri` is not: rustup does
    # not install the Tauri CLI. main() installs it, then uses cargo-override.
    BUILD_PATH="install-tauri-cli"
    log "Build path: cargo-tauri override needs the Tauri CLI, which is not installed (rustup does not provide it)."
    return 0
  fi
  if have cargo; then
    die "pnpm is unavailable and the frontend dist is missing ($DESKTOP_DIST_RELATIVE_PATH). Build the frontend on a machine with Node+pnpm ('pnpm --filter desktop build') and copy it here, or install Node+pnpm ('corepack enable') and re-run."
  fi
  die "Neither pnpm nor cargo is available. Install Node+pnpm (https://pnpm.io/installation) or the Rust toolchain (https://rustup.rs), then re-run."
}

build_sidecar() {
  local sidecar_flag=""
  if [ "$DEV_MODE" -eq 1 ]; then sidecar_flag="--dev"; fi
  have bun || die "bun is required to build the sidecar (externalBin). Install it from https://bun.sh and re-run."
  log "Building bun sidecar binary (externalBin)."
  ( cd "$REPO_DIR/apps/desktop" && bun scripts/build-sidecar.mjs $sidecar_flag )
}

build_project() {
  cd "$REPO_DIR"

  if [ "$BUILD_PATH" = "pnpm" ]; then
    log "Installing workspace dependencies (pnpm install --frozen-lockfile)."
    pnpm install --frozen-lockfile

    log "Building desktop frontend dist (tsc -b && vite build)."
    pnpm --filter desktop build
  else
    # cargo-override path: the frontend dist must already exist (checked in
    # detect_build_path); there is no Node/pnpm here to build it.
    log "Skipping pnpm install + frontend build; reusing pre-built dist at $DESKTOP_DIST_RELATIVE_PATH."
  fi

  build_sidecar
}

# Build via cargo directly, blanking the pnpm-based beforeBuildCommand with a
# --config override file written to a temp dir (never into the working tree).
build_tauri_override() {
  BUILD_OVERRIDE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/deskspawn-build-override.XXXXXX")"
  local override_file="$BUILD_OVERRIDE_DIR/$BUILD_OVERRIDE_FILE_NAME"
  printf '%s\n' "$BUILD_OVERRIDE_JSON" > "$override_file"

  cd "$REPO_DIR/apps/desktop/src-tauri"
  if [ "$NO_BUNDLE" -eq 1 ]; then
    log "using cargo-tauri override: cargo tauri build --no-bundle --config $override_file"
    cargo tauri build --no-bundle --config "$override_file"
  else
    log "using cargo-tauri override: cargo tauri build --config $override_file"
    cargo tauri build --config "$override_file"
  fi
}

build_tauri() {
  if [ "$BUILD_PATH" = "pnpm" ]; then
    cd "$REPO_DIR"
    if [ "$NO_BUNDLE" -eq 1 ]; then
      log "using pnpm: pnpm --filter desktop tauri build --no-bundle"
      pnpm --filter desktop tauri build --no-bundle
    else
      log "using pnpm: pnpm --filter desktop tauri build"
      pnpm --filter desktop tauri build
    fi
  else
    build_tauri_override
  fi
}

print_summary() {
  local bundle="$REPO_DIR/apps/desktop/src-tauri/target/release/bundle"
  local app_bin="$REPO_DIR/apps/desktop/src-tauri/target/release/deskspawn-desktop"
  echo
  log "Build complete."
  echo "  Repository : $REPO_DIR"
  if [ -d "$bundle" ]; then
    echo "  Installers :"
    find "$bundle" -maxdepth 2 -type f \
      \( -name '*.msi' -o -name '*-setup.exe' -o -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \
      -o -name '*.AppImage.tar.gz' -o -name '*.app.tar.gz' -o -name '*.nsis.zip' -o -name '*.sig' \) \
      -print 2>/dev/null | sed 's/^/    /'
  fi
  if [ -x "$app_bin" ]; then echo "  App binary : $app_bin"; fi
  echo
  echo "  Launch (dev): cd \"$REPO_DIR\" && pnpm --filter desktop tauri dev"
  echo "  App data root (~/deskspawn/) was not touched."
}

main() {
  log "DeskSpawn bootstrap — OS=$OS ref=$REF no-bundle=$NO_BUNDLE dev=$DEV_MODE"

  if [ "$SKIP_DEPS" -eq 0 ]; then
    ensure_git
    ensure_node
    ensure_pnpm
    ensure_bun
    ensure_rust
    ensure_linux_deps
  else
    log "Skipping prerequisite installation (--skip-deps)."
  fi

  resolve_repo
  sync_repo
  detect_build_path
  if [ "$BUILD_PATH" = "install-tauri-cli" ]; then
    log "Installing the Tauri CLI: $TAURI_CLI_INSTALL_COMMAND"
    log "This compiles from source and can take several minutes and a few hundred MB of disk."
    cargo install tauri-cli --locked || die "Tauri CLI installation failed. Install it manually with: $TAURI_CLI_INSTALL_COMMAND"
    tauri_cli_available || die "Tauri CLI still unavailable after install. Install it manually with: $TAURI_CLI_INSTALL_COMMAND"
    BUILD_PATH="cargo-override"
    log "Tauri CLI installed; using the cargo-tauri override path."
  fi
  build_project

  if [ "$DEV_MODE" -eq 1 ]; then
    if [ "$BUILD_PATH" != "pnpm" ]; then
      die "Cannot run 'tauri dev' in the cargo-override path: the dev server comes from the pnpm beforeDevCommand. Install Node+pnpm ('corepack enable') and re-run with --dev."
    fi
    echo
    log "Everything is prepared. Start the app in dev mode with:"
    echo "  cd \"$REPO_DIR\" && pnpm --filter desktop tauri dev"
    exit 0
  fi

  build_tauri

  print_summary
}

# Only run main() when this file is executed, not when it is sourced. The tests
# (scripts/bootstrap.test.mjs) source it to execute validate_ref / version_ge /
# detect_build_path directly against the shipped shell logic.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
