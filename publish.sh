#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="apartment-v$(date -u +%Y%m%d%H%M)"

perl -0pi -e "s/const CACHE = \"apartment-v[^\"]+\";/const CACHE = \"$VERSION\";/" "$SCRIPT_DIR/sw.js"

echo "$VERSION"
echo "Service worker cache bumped. Commit and push to publish the latest app shell."
