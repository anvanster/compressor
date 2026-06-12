#!/usr/bin/env bash
# compressor — one-line installer (macOS / Linux / WSL).
#
# Installs the `compressor` CLI globally from GitHub. The package builds itself
# from source during install (npm runs the `prepare` script), so no prebuilt
# artifacts are needed.
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/anvanster/compressor/main/install.sh | bash
#
# Install a specific tag/branch/commit:
#   curl -fsSL https://raw.githubusercontent.com/anvanster/compressor/main/install.sh | COMPRESSOR_REF=v0.3.0 bash
#
# Local clone:
#   bash install.sh
set -euo pipefail

REPO="${COMPRESSOR_REPO:-anvanster/compressor}"
REF="${COMPRESSOR_REF:-main}"
MIN_NODE_MAJOR=20

err() { echo "compressor: $*" >&2; }

# --- prerequisites -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  err "Node.js (>= ${MIN_NODE_MAJOR}) is required but was not found."
  err "Install it from https://nodejs.org or via nvm (https://github.com/nvm-sh/nvm)."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  err "Node $(node -v) is too old; need Node >= ${MIN_NODE_MAJOR}."
  err "Upgrade: https://nodejs.org"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  err "npm is required (it ships with Node.js)."
  exit 1
fi

# --- install -----------------------------------------------------------------
echo "compressor: installing from github:${REPO}#${REF} ..."
npm install -g "github:${REPO}#${REF}"

# --- verify ------------------------------------------------------------------
echo ""
if command -v compressor >/dev/null 2>&1; then
  echo "compressor: installed $(compressor --version)"
  echo "  next: cd into a project and run"
  echo "        compressor init --agent claude-code   # or: copilot | cursor | opencode | agents-md"
else
  err "installed, but 'compressor' is not on your PATH."
  err "Add your npm global bin directory to PATH, e.g.:"
  err "  echo 'export PATH=\"\$(npm prefix -g)/bin:\$PATH\"' >> ~/.profile && . ~/.profile"
fi
