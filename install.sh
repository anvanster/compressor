#!/usr/bin/env bash
# compressor — one-line installer (macOS / Linux / WSL).
#
# Downloads the requested ref from GitHub, builds it (devDependencies present),
# packs the npm tarball, and installs THAT globally — so the installed artifact
# is byte-identical in shape to a registry install (dist/ + docs only).
#
# Why not `npm install -g github:...`: npm does not install devDependencies
# when preparing GLOBAL git installs, so the `prepare` build fails with
# "tsc: command not found" and the package lands without dist/. Verified
# 2026-06-12; this script exists to avoid that path.
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/anvanster/compressor/main/install.sh | bash
#
# Install a specific tag/branch/commit:
#   curl -fsSL https://raw.githubusercontent.com/anvanster/compressor/main/install.sh | COMPRESSOR_REF=v0.3.0 bash
#
# Optional: COMPRESSOR_NPM_PREFIX=/some/prefix to install into a non-default
# npm prefix (used by CI/tests; end users normally omit it).
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

if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  err "curl or wget is required to download the source."
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  err "tar is required to extract the source."
  exit 1
fi

# --- download + build --------------------------------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/compressor-install.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

TARBALL_URL="https://codeload.github.com/${REPO}/tar.gz/${REF}"
echo "compressor: downloading ${REPO}@${REF} ..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$TARBALL_URL" -o "$WORK/src.tar.gz"
else
  wget -q "$TARBALL_URL" -O "$WORK/src.tar.gz"
fi

mkdir -p "$WORK/src"
tar -xzf "$WORK/src.tar.gz" -C "$WORK/src" --strip-components=1

echo "compressor: building (this fetches dev dependencies once) ..."
(
  cd "$WORK/src"
  npm install --no-audit --no-fund --loglevel=error
  npm run build
  npm pack --pack-destination "$WORK" >/dev/null
)

PKG_TGZ="$(ls "$WORK"/*.tgz | head -1)"
if [ -z "$PKG_TGZ" ]; then
  err "build succeeded but no package tarball was produced — aborting."
  exit 1
fi

# --- install -----------------------------------------------------------------
echo "compressor: installing globally ..."
if [ -n "${COMPRESSOR_NPM_PREFIX:-}" ]; then
  npm install -g --prefix "$COMPRESSOR_NPM_PREFIX" --no-audit --no-fund --loglevel=error "$PKG_TGZ"
  BIN_DIR="$COMPRESSOR_NPM_PREFIX/bin"
else
  npm install -g --no-audit --no-fund --loglevel=error "$PKG_TGZ"
  BIN_DIR="$(npm prefix -g)/bin"
fi

# --- verify ------------------------------------------------------------------
echo ""
if [ -x "$BIN_DIR/compressor" ]; then
  echo "compressor: installed $("$BIN_DIR/compressor" --version) at $BIN_DIR/compressor"
  echo "  next: cd into a project and run"
  echo "        compressor init --agent claude-code   # or: copilot | cursor | opencode | agents-md"
  if ! command -v compressor >/dev/null 2>&1; then
    err "note: '$BIN_DIR' is not on your PATH yet:"
    err "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile && . ~/.profile"
  fi
else
  err "installed, but 'compressor' was not found at $BIN_DIR."
  err "Check 'npm prefix -g' and your PATH."
  exit 1
fi
