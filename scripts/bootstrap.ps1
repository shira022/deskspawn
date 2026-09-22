#Requires -Version 5.1
<#
.SYNOPSIS
  DeskSpawn bootstrap (Windows PowerShell).

.DESCRIPTION
  Idempotent: safe to run repeatedly; already-satisfied steps are skipped.
  Detects (and where possible installs) the toolchain needed to build the
  DeskSpawn desktop app, clones or updates the repository, installs workspace
  dependencies, builds the bun sidecar + frontend, and optionally bundles the
  installers.

  Visual Studio Build Tools (C++ workload) are detected but never installed
  silently: they require elevation and a large download, so the exact doc link
  is printed instead.

  Build paths (the host may have no Node/pnpm at all):
    - "using pnpm": pnpm is on PATH. It installs deps, builds the frontend dist
      (pnpm --filter desktop build) and drives the Tauri CLI.
    - "using cargo-tauri override": pnpm is absent but cargo is present AND the
      frontend dist is already built. The Tauri config's beforeBuildCommand
      shells out to pnpm, so we pass a --config override that blanks it and run
      `cargo tauri build` directly from apps\desktop\src-tauri.
      NOTE (--skip-frontend): in this path the frontend dist
      (apps\desktop\dist) MUST be pre-built; the script fails with an
      actionable message instead of pretending to build it.
    - "impossible": neither route is viable; the script exits with instructions.

  The app data root (%USERPROFILE%\deskspawn) is never touched. Only the source
  checkout (and, on a fresh machine, the chosen clone directory) is modified.

.PARAMETER Ref
  Git ref (branch or tag) to check out. Default: main.

.PARAMETER Dir
  Directory to clone into when not already inside a checkout.
  Default: $HOME\deskspawn-src.

.PARAMETER NoBundle
  Fast build only (tauri build --no-bundle), no installers.

.PARAMETER Dev
  Prepare everything, then print the `tauri dev` command.

.PARAMETER SkipDeps
  Do not detect/install prerequisites (CI/advanced use).

.PARAMETER Help
  Show this help.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1 --Ref main
#>
[CmdletBinding()]
param(
  [string]$Ref = 'main',
  [string]$Dir = '',
  [switch]$NoBundle,
  [switch]$Dev,
  [switch]$SkipDeps,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# NOTE: The pure decision helpers (ref parsing, version comparison, missing
# prerequisite evaluation, build-path selection) are unit-tested in
# scripts/bootstrap-lib.mjs (see scripts/bootstrap.test.mjs). This script
# mirrors those rules because it must be able to run before Node.js exists.
# Keep both in sync.

$MinNode = [version]'20.0.0'
$MinBun = [version]'1.3.0'
$PinnedBun = '1.3.14'
$VsBuildToolsUrl = 'https://visualstudio.microsoft.com/visual-cpp-build-tools/'

# Mirrors scripts/bootstrap-lib.mjs (keep in sync).
$DesktopDistRelativePath = 'apps\desktop\dist'
$BuildOverrideFileName = '.bootstrap-build-override.json'
$BuildOverrideJson = '{"build":{"beforeBuildCommand":""}}'
$script:BuildPath = ''

function Write-Log { param([string]$Message) Write-Host "[bootstrap] $Message" }
function Write-Warn { param([string]$Message) Write-Warning "[bootstrap] $Message" }
function Die { param([string]$Message) Write-Error "[bootstrap] $Message"; exit 1 }

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-Semver {
  param([string]$Raw)
  if (-not $Raw) { return $null }
  $clean = $Raw.Trim().TrimStart('v', 'V')
  $m = [regex]::Match($clean, '^(\d+)\.(\d+)\.(\d+)')
  if (-not $m.Success) { return $null }
  return [version]("$($m.Groups[1].Value).$($m.Groups[2].Value).$($m.Groups[3].Value)")
}

function Install-WithWinget {
  param([string]$Id, [string]$Label, [string]$ApproxSize)
  if (-not (Test-Command 'winget')) {
    Write-Warn "winget is unavailable; install $Label manually."
    return $false
  }
  Write-Log "Installing $Label via winget ($ApproxSize)..."
  winget install --id $Id --exact --accept-source-agreements --accept-package-agreements
  return $true
}

# ── Prerequisite detection / installation ───────────────────────────

function Ensure-Git {
  if (Test-Command 'git') { Write-Log "git found: $(git --version)"; return }
  Write-Log 'git is missing; attempting to install it (~50 MB disk).'
  [void](Install-WithWinget -Id 'Git.Git' -Label 'Git' -ApproxSize '~50 MB')
  if (-not (Test-Command 'git')) { Die 'git is required. Install from https://git-scm.com/download/win then re-run.' }
}

function Ensure-Node {
  if (Test-Command 'node') {
    $v = Get-Semver (& node --version)
    if ($v -and $v -ge $MinNode) { Write-Log "node found: $(& node --version)"; return }
    Write-Warn "node $(& node --version) is older than $MinNode; attempting upgrade."
  } else {
    Write-Log 'node is missing; attempting to install Node.js LTS (~120 MB disk).'
  }
  # Best-effort: Node+pnpm are only needed for the pnpm build path. If this
  # cannot be installed, fall through so Resolve-BuildPath can choose the
  # cargo-tauri override path (or fail with a combined, actionable message).
  [void](Install-WithWinget -Id 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS' -ApproxSize '~120 MB')
  if (Test-Command 'node') {
    $v = Get-Semver (& node --version)
    if ($v -and $v -ge $MinNode) { Write-Log "node ready: $(& node --version)"; return }
  }
  Write-Warn "Node.js >= $MinNode is unavailable. Install it (https://nodejs.org) for the pnpm path;"
  Write-Warn 'the cargo-tauri override path can proceed without it if the frontend dist is pre-built.'
}

function Ensure-Pnpm {
  if (Test-Command 'pnpm') { Write-Log "pnpm found: $(pnpm --version)"; return }
  if (Test-Command 'corepack') {
    Write-Log 'Enabling pnpm via corepack (bundled with Node; no extra download).'
    try {
      corepack enable
    } catch {
      try { corepack enable --install-directory "$HOME\.local\bin" } catch { }
    }
    $corepackDir = "$HOME\.local\bin"
    if (Test-Path $corepackDir) { $env:PATH = "$corepackDir;$env:PATH" }
  }
  if (Test-Command 'pnpm') { Write-Log "pnpm enabled: $(pnpm --version)"; return }
  Write-Warn 'pnpm is unavailable and could not be enabled via corepack.'
  Write-Warn 'Falling back to the cargo-tauri override path (requires a pre-built frontend dist).'
}

function Ensure-Bun {
  if (Test-Command 'bun') {
    $v = Get-Semver (& bun --version)
    if ($v -and $v -ge $MinBun) { Write-Log "bun found: $(& bun --version)"; return }
    Write-Warn "bun $(& bun --version) is older than $MinBun; installing v$PinnedBun."
  }
  if (-not $env:BUN_INSTALL) { $env:BUN_INSTALL = "$HOME\.bun" }
  Write-Log "Installing bun v$PinnedBun (~90 MB disk, to $env:BUN_INSTALL)."
  $env:BUN_VERSION = $PinnedBun
  try {
    powershell -NoProfile -Command "irm bun.sh/install.ps1 | iex"
  } catch {
    Die 'bun installation failed; install from https://bun.sh then re-run.'
  }
  $env:PATH = "$env:BUN_INSTALL\bin;$env:PATH"
  if (-not (Test-Command 'bun')) { Die 'bun installation failed; install from https://bun.sh then re-run.' }
}

function Ensure-Rust {
  if ((Test-Command 'rustc') -and (Test-Command 'cargo')) { Write-Log "rustc found: $(& rustc --version)"; return }
  Write-Log 'Installing Rust via rustup (MSVC toolchain, ~300 MB disk).'
  [void](Install-WithWinget -Id 'Rustlang.Rustup' -Label 'Rustup' -ApproxSize '~300 MB')
  $cargoBin = "$HOME\.cargo\bin"
  if (Test-Path $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
  if (-not ((Test-Command 'rustc') -and (Test-Command 'cargo'))) {
    Die 'Rust is required. Install from https://rustup.rs then re-run (choose the MSVC toolchain).'
  }
}

function Test-VsBuildTools {
  $pf86 = [Environment]::GetFolderPath('ProgramFilesX86')
  if (-not $pf86) { return $false }
  $vswhere = Join-Path $pf86 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) { return $false }
  $found = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  return [bool]$found
}

function Assert-VsBuildTools {
  if (Test-VsBuildTools) { Write-Log 'Visual Studio Build Tools (C++ workload) found.'; return }
  Write-Warn 'Visual Studio Build Tools with the "Desktop development with C++" workload were not detected.'
  Write-Warn 'The Windows Rust (MSVC) build cannot link without them. Install them manually (large download, needs admin):'
  Write-Warn "  $VsBuildToolsUrl"
  Write-Warn 'Select the "Desktop development with C++" workload during installation.'
}

# ── Repository resolution / clone / update ──────────────────────────

function Test-IsCheckout {
  param([string]$Path)
  if (-not $Path) { return $false }
  $conf = Join-Path $Path 'apps\desktop\src-tauri\tauri.conf.json'
  if (-not (Test-Path $conf)) { return $false }
  Push-Location $Path
  try {
    git rev-parse --is-inside-work-tree *> $null
    return ($LASTEXITCODE -eq 0)
  } finally {
    Pop-Location
  }
}

function Sync-Repo {
  param([string]$RepoDir, [string]$Ref)
  $url = if ($env:DESKSPAWN_REPO_URL) { $env:DESKSPAWN_REPO_URL } else { 'https://github.com/shira022/deskspawn.git' }
  if (Test-Path (Join-Path $RepoDir '.git')) {
    Write-Log "Updating existing clone at $RepoDir (ref: $Ref)."
    git -C $RepoDir fetch --depth 1 origin $Ref
    git -C $RepoDir checkout $Ref
    git -C $RepoDir pull --ff-only origin $Ref 2>$null
  } else {
    if ((Test-Path $RepoDir) -and (Get-ChildItem -Force $RepoDir | Select-Object -First 1)) {
      Die "Directory $RepoDir exists and is not a DeskSpawn checkout. Choose another -Dir."
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RepoDir) | Out-Null
    Write-Log "Cloning $url (ref: $Ref) into $RepoDir (~200 MB disk)."
    git clone --depth 1 --branch $Ref $url $RepoDir
  }
}

# ── Build ───────────────────────────────────────────────────────────

function Test-FrontendDist {
  param([string]$RepoDir)
  return (Test-Path (Join-Path $RepoDir "$DesktopDistRelativePath\index.html"))
}

# Decide (and log) which build route to use. Mirrors decideBuildPath() in
# scripts/bootstrap-lib.mjs; keep the two in sync. Sets $script:BuildPath.
function Resolve-BuildPath {
  param([string]$RepoDir)
  if (Test-Command 'pnpm') {
    $script:BuildPath = 'pnpm'
    Write-Log 'Build path: using pnpm (installs deps, builds the frontend dist, drives the Tauri CLI).'
    return
  }
  if ((Test-Command 'cargo') -and (Test-FrontendDist -RepoDir $RepoDir)) {
    $script:BuildPath = 'cargo-override'
    Write-Log 'Build path: using cargo-tauri override (pnpm not found; reusing the pre-built frontend dist).'
    return
  }
  if (Test-Command 'cargo') {
    Die "pnpm is unavailable and the frontend dist is missing ($DesktopDistRelativePath). Build the frontend on a machine with Node+pnpm ('pnpm --filter desktop build') and copy it here, or install Node+pnpm ('corepack enable') and re-run."
  }
  Die 'Neither pnpm nor cargo is available. Install Node+pnpm (https://pnpm.io/installation) or the Rust toolchain (https://rustup.rs), then re-run.'
}

function Build-Sidecar {
  param([switch]$DevMode)
  if (-not (Test-Command 'bun')) {
    Die 'bun is required to build the sidecar (externalBin). Install it from https://bun.sh and re-run.'
  }
  Write-Log 'Building bun sidecar binary (externalBin).'
  Push-Location 'apps\desktop'
  try {
    if ($DevMode) { bun scripts/build-sidecar.mjs --dev } else { bun scripts/build-sidecar.mjs }
  } finally {
    Pop-Location
  }
}

function Build-Project {
  param([string]$RepoDir, [switch]$DevMode)
  Push-Location $RepoDir
  try {
    if ($script:BuildPath -eq 'pnpm') {
      Write-Log 'Installing workspace dependencies (pnpm install --frozen-lockfile).'
      pnpm install --frozen-lockfile
      Write-Log 'Building desktop frontend dist (tsc -b && vite build).'
      pnpm --filter desktop build
    } else {
      # --skip-frontend: the frontend dist must already exist (checked in
      # Resolve-BuildPath); there is no Node/pnpm here to build it.
      Write-Log "Skipping pnpm install + frontend build; reusing pre-built dist at $DesktopDistRelativePath."
    }
    Build-Sidecar -DevMode:$DevMode
  } finally {
    Pop-Location
  }
}

# Build via cargo directly, blanking the pnpm-based beforeBuildCommand with a
# --config override file written to a temp dir (never into the working tree).
function Build-TauriOverride {
  param([string]$RepoDir)
  $overrideFile = [System.IO.Path]::GetTempFileName()
  try {
    # ASCII (no BOM) so serde_json on the Tauri CLI side parses it cleanly.
    Set-Content -Path $overrideFile -Value $BuildOverrideJson -Encoding ascii
    Push-Location (Join-Path $RepoDir 'apps\desktop\src-tauri')
    try {
      if ($NoBundle) {
        Write-Log "using cargo-tauri override: cargo tauri build --no-bundle --config `"$overrideFile`""
        cargo tauri build --no-bundle --config $overrideFile
      } else {
        Write-Log "using cargo-tauri override: cargo tauri build --config `"$overrideFile`""
        cargo tauri build --config $overrideFile
      }
    } finally {
      Pop-Location
    }
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $overrideFile
  }
}

function Build-Tauri {
  param([string]$RepoDir)
  if ($script:BuildPath -eq 'pnpm') {
    Push-Location $RepoDir
    try {
      if ($NoBundle) {
        Write-Log 'using pnpm: pnpm --filter desktop tauri build --no-bundle'
        pnpm --filter desktop tauri build --no-bundle
      } else {
        Write-Log 'using pnpm: pnpm --filter desktop tauri build'
        pnpm --filter desktop tauri build
      }
    } finally {
      Pop-Location
    }
  } else {
    Build-TauriOverride -RepoDir $RepoDir
  }
}

function Show-Summary {
  param([string]$RepoDir)
  $bundle = Join-Path $RepoDir 'apps\desktop\src-tauri\target\release\bundle'
  $appBin = Join-Path $RepoDir 'apps\desktop\src-tauri\target\release\deskspawn-desktop.exe'
  Write-Host ''
  Write-Log 'Build complete.'
  Write-Host "  Repository : $RepoDir"
  if (Test-Path $bundle) {
    Write-Host '  Installers :'
    Get-ChildItem -Path $bundle -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '\.(msi|deb|rpm|AppImage)$' -or $_.Name -like '*-setup.exe' } |
      ForEach-Object { Write-Host "    $($_.FullName)" }
  }
  if (Test-Path $appBin) { Write-Host "  App binary : $appBin" }
  Write-Host ''
  Write-Host "  Launch (dev): cd `"$RepoDir`"; pnpm --filter desktop tauri dev"
  Write-Host '  The app data root (%USERPROFILE%\deskspawn) was not touched.'
}

function Main {
  Write-Log "DeskSpawn bootstrap — ref=$Ref no-bundle=$($NoBundle.IsPresent) dev=$($Dev.IsPresent)"

  if (-not $SkipDeps) {
    Ensure-Git
    Ensure-Node
    Ensure-Pnpm
    Ensure-Bun
    Ensure-Rust
    Assert-VsBuildTools
  } else {
    Write-Log 'Skipping prerequisite installation (-SkipDeps).'
  }

  if (Test-IsCheckout (Get-Location).Path) {
    $repoDir = (Get-Location).Path
    Write-Log "Running inside an existing checkout: $repoDir"
  } elseif ($Dir) {
    $repoDir = $Dir
  } else {
    $repoDir = Join-Path $HOME 'deskspawn-src'
  }

  Sync-Repo -RepoDir $repoDir -Ref $Ref
  Resolve-BuildPath -RepoDir $repoDir
  Build-Project -RepoDir $repoDir -DevMode:$Dev

  if ($Dev) {
    if ($script:BuildPath -ne 'pnpm') {
      Die "Cannot run 'tauri dev' in the cargo-override path: the dev server comes from the pnpm beforeDevCommand. Install Node+pnpm ('corepack enable') and re-run with -Dev."
    }
    Write-Host ''
    Write-Log 'Everything is prepared. Start the app in dev mode with:'
    Write-Host "  cd `"$repoDir`"; pnpm --filter desktop tauri dev"
    return
  }

  Build-Tauri -RepoDir $repoDir

  Show-Summary -RepoDir $repoDir
}

if ($Help) {
  Get-Help $PSCommandPath -Detailed
  return
}

Main
