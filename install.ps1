#!/usr/bin/env pwsh
# compressor - one-line installer (Windows / PowerShell).
#
# Installs the `compressor` CLI globally from GitHub. The package builds itself
# from source during install (npm runs the `prepare` script), so no prebuilt
# artifacts are needed.
#
# One-line install:
#   irm https://raw.githubusercontent.com/anvanster/compressor/main/install.ps1 | iex
#
# Install a specific tag/branch/commit:
#   $env:COMPRESSOR_REF = 'v0.3.0'
#   irm https://raw.githubusercontent.com/anvanster/compressor/main/install.ps1 | iex
#
# Local clone:
#   ./install.ps1

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

# --- install -----------------------------------------------------------------
Write-Host "compressor: installing from github:$Repo#$Ref ..."
npm install -g "github:$Repo#$Ref"
if ($LASTEXITCODE -ne 0) { Fail "npm install failed (exit code $LASTEXITCODE)." }

# --- verify ------------------------------------------------------------------
Write-Host ""
if (Get-Command compressor -ErrorAction SilentlyContinue) {
  Write-Host "compressor: installed $(compressor --version)" -ForegroundColor Green
  Write-Host "  next: cd into a project and run"
  Write-Host "        compressor init --agent claude-code   # or: copilot | cursor | opencode | agents-md"
} else {
  Write-Warning "compressor: installed, but 'compressor' is not on your PATH. Restart your shell, or check 'npm prefix -g'."
}
