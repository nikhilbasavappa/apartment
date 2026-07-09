#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "$SCRIPT_DIR/scan.cjs" "$@"

if [[ -f "$SCRIPT_DIR/.sync.json" ]]; then
  node "$SCRIPT_DIR/sync-report.cjs"
fi
