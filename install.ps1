#!/usr/bin/env pwsh
# compressor - one-line installer (Windows / PowerShell).
#
# Downloads the requested ref from GitHub, builds it (devDependencies present),
# packs the npm tarball, and installs THAT globally - so the installed artifact
# is byte-identical in shape to a registry install (dist/ + docs only).
#
# Why not `npm install -g github:...`: npm does not install devDependencies
# when preparing GLOBAL git installs, so the `prepare` build fails with
# "tsc: command not found" and the package lands without dist/. Verified
# 2026-06-12; this script exists to avoid that path.
#
# One-line install:
#   irm https://raw.githubusercontent.com/anvanster/compressor/main/install.ps1 | iex
#
# Install a specific tag/branch/commit:
#   $env:COMPRESSOR_REF = 'v0.3.0'
#   irm https://raw.githubusercontent.com/anvanster/compressor/main/install.ps1 | iex
#
# Optional: $env:COMPRESSOR_NPM_PREFIX to install into a non-default npm
# prefix (used by CI/tests; end users normally omit it).

$ErrorActionPreference = 'Stop'

$Repo = if ($env:COMPRESSOR_REPO) { $env:COMPRESSOR_REPO } else { 'anvanster/compressor' }
$Ref  = if ($env:COMPRESSOR_REF)  { $env:COMPRESSOR_REF }  else { 'main' }
$MinNodeMajor = 20

function Fail($msg) {
  Write-Host "compressor: $msg" -ForegroundColor Red
  exit 1
}

# --- prerequisites -----------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js (>= $MinNodeMajor) is required but was not found. Install it from https://nodejs.org"
}

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt $MinNodeMajor) {
  Fail "Node $(node -v) is too old; need Node >= $MinNodeMajor. Upgrade: https://nodejs.org"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm is required (it ships with Node.js)."
}

# --- download + build --------------------------------------------------------
$Work = Join-Path ([System.IO.Path]::GetTempPath()) ("compressor-install-" + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Work | Out-Null

try {
  $ZipUrl = "https://codeload.github.com/$Repo/zip/$Ref"
  $ZipPath = Join-Path $Work 'src.zip'
  Write-Host "compressor: downloading $Repo@$Ref ..."
  Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath

  Expand-Archive -Path $ZipPath -DestinationPath (Join-Path $Work 'unzipped')
  $SrcDir = Get-ChildItem -Directory (Join-Path $Work 'unzipped') | Select-Object -First 1

  Write-Host "compressor: building (this fetches dev dependencies once) ..."
  Push-Location $SrcDir.FullName
  try {
    npm install --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed (exit code $LASTEXITCODE)." }
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail "build failed (exit code $LASTEXITCODE)." }
    npm pack --pack-destination $Work | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "npm pack failed (exit code $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }

  $Tarball = Get-ChildItem (Join-Path $Work '*.tgz') | Select-Object -First 1
  if (-not $Tarball) { Fail "build succeeded but no package tarball was produced - aborting." }

  # --- install ---------------------------------------------------------------
  Write-Host "compressor: installing globally ..."
  if ($env:COMPRESSOR_NPM_PREFIX) {
    npm install -g --prefix $env:COMPRESSOR_NPM_PREFIX --no-audit --no-fund --loglevel=error $Tarball.FullName
  } else {
    npm install -g --no-audit --no-fund --loglevel=error $Tarball.FullName
  }
  if ($LASTEXITCODE -ne 0) { Fail "npm install -g failed (exit code $LASTEXITCODE)." }
} finally {
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
}

# --- verify ------------------------------------------------------------------
Write-Host ""
if (Get-Command compressor -ErrorAction SilentlyContinue) {
  Write-Host "compressor: installed $(compressor --version)" -ForegroundColor Green
  Write-Host "  next: cd into a project and run"
  Write-Host "        compressor init --agent claude-code   # or: copilot | cursor | opencode | agents-md"
} else {
  Write-Warning "compressor: installed, but 'compressor' is not on your PATH. Restart your shell, or check 'npm prefix -g'."
}
