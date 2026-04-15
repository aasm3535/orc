#!/usr/bin/env bash
#
# build-release.sh — compile TypeScript + package into standalone binaries
#
# Usage:
#   ./scripts/build-release.sh          # build all platforms
#   ./scripts/build-release.sh linux     # build only linux
#   ./scripts/build-release.sh macos     # build only macos
#   ./scripts/build-release.sh windows   # build only windows
#
# Outputs binaries to: release/orc-{platform}{.exe}
#
# Requires: npm install (devDependencies include @yao-pkg/pkg)
#

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-$(node -p 'require("./package.json").version')}"

echo "── Orc v${VERSION} ── Build Release ──"

# Step 1: Compile TypeScript
echo ""
echo "1. Compiling TypeScript..."
npm run build
echo "   ✓ dist/"

# Step 2: Add shebang to entry point (needed for pkg to know it's a CLI)
ENTRY="dist/index.js"
if [ ! -f "$ENTRY" ]; then
  echo "   ✗ dist/index.js not found"
  exit 1
fi

# Step 3: Package into standalone binaries
echo ""
echo "2. Packaging binaries with pkg..."

mkdir -p release

# pkg targets: node18-{platform}-x64
TARGETS=""
case "${2:-all}" in
  linux)   TARGETS="node18-linux-x64" ;;
  macos)   TARGETS="node18-macos-x64" ;;
  windows) TARGETS="node18-win-x64" ;;
  all)     TARGETS="node18-linux-x64,node18-macos-x64,node18-win-x64" ;;
  *)
    echo "Unknown platform: $2 (use: linux, macos, windows, all)"
    exit 1
    ;;
esac

npx @yao-pkg/pkg "$ENTRY" \
  --target "$TARGETS" \
  --output "release/orc" \
  --config package.json \
  --no-bytecode \
  --public

# Rename outputs to include platform
echo ""
echo "3. Renaming binaries..."

for f in release/orc-*; do
  [ -f "$f" ] || continue
  case "$f" in
    *-linux*)   mv "$f" "release/orc-linux-x64" ;;
    *-macos*)   mv "$f" "release/orc-macos-x64" ;;
    *-win*)     mv "$f" "release/orc-win-x64.exe" ;;
    *)          echo "   ? unknown: $f" ;;
  esac
done

echo ""
echo "── Done ──"
echo ""
ls -lh release/orc-* 2>/dev/null || echo "   (no binaries found)"
echo ""
echo "Next: Create a GitHub release and upload these binaries"
echo "  gh release create v${VERSION} release/orc-* --title \"v${VERSION}\" --notes \"Release v${VERSION}\""
