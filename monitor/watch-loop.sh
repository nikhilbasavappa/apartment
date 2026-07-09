#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERVAL_MINUTES="${1:-30}"

while true; do
  "$SCRIPT_DIR/run-scan.sh"
  sleep "$(( INTERVAL_MINUTES * 60 ))"
done
