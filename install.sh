#!/usr/bin/env bash
#
# install.sh — Install Orc as a standalone binary (no Node.js needed)
#
# Usage:
#   curl -fsSL https://github.com/aasm3535/orc/raw/master/install.sh | sh
#
# Or download directly:
#   curl -fsSL -o ~/.local/bin/orc https://github.com/aasm3535/orc/releases/latest/download/orc-linux-x64
#   chmod +x ~/.local/bin/orc
#

set -euo pipefail

REPO="aasm3535/orc"
BINARY="orc"

# ── Detect platform ──
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  linux)  PLATFORM="linux-x64" ;;
  darwin) PLATFORM="macos-x64" ;;
  mingw*|msys*|cygwin*|windows*)
    echo "Windows detected. Use install.ps1 instead:"
    echo '  irm https://github.com/aasm3535/orc/raw/master/install.ps1 | iex'
    exit 1
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) ;; # x64 — ok
  arm64|aarch64)
    if [ "$OS" = "darwin" ]; then
      PLATFORM="macos-arm64"
    else
      echo "ARM64 Linux not yet supported. Open an issue: https://github.com/$REPO/issues"
      exit 1
    fi
    ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

FILENAME="orc-${PLATFORM}"
URL="https://github.com/${REPO}/releases/latest/download/${FILENAME}"

# ── Pick install directory ──
if [ -w "/usr/local/bin" ]; then
  BINDIR="/usr/local/bin"
elif [ -w "${HOME}/.local/bin" ]; then
  BINDIR="${HOME}/.local/bin"
else
  BINDIR="${HOME}/.local/bin"
  mkdir -p "$BINDIR"
fi

TARGET="${BINDIR}/${BINARY}"

# ── Download ──
echo "── Orc Installer ──"
echo ""
echo "  Platform: ${PLATFORM}"
echo "  Binary:   ${FILENAME}"
echo "  Install:  ${TARGET}"
echo ""

if command -v curl >/dev/null 2>&1; then
  echo "  Downloading..."
  curl -fsSL -o "$TARGET" "$URL"
elif command -v wget >/dev/null 2>&1; then
  echo "  Downloading..."
  wget -q -O "$TARGET" "$URL"
else
  echo "  Error: curl or wget required"
  exit 1
fi

chmod +x "$TARGET"

# ── Verify ──
if "$TARGET" --version >/dev/null 2>&1; then
  VERSION=$("$TARGET" --version 2>/dev/null || echo "unknown")
  echo ""
  echo "  ✓ Orc v${VERSION} installed to ${TARGET}"
else
  echo ""
  echo "  ⚠ Binary downloaded but verification failed"
  echo "    Try running: ${TARGET} --help"
fi

# ── PATH hint ──
if ! echo "$PATH" | grep -q "$BINDIR" 2>/dev/null; then
  echo ""
  echo "  Add to PATH:"
  echo "    echo 'export PATH=\"${BINDIR}:\$PATH\"' >> ~/.bashrc"
  echo "    source ~/.bashrc"
fi

echo ""
