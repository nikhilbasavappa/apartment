#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolve_deps_root() {
  local candidate
  for candidate in \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies" \
    "$HOME/.cache/codex-runtimes/codex-secondary-runtime/dependencies"
  do
    if [[ -x "$candidate/node/bin/node" && -d "$candidate/node/node_modules" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  for candidate in "$HOME"/.cache/codex-runtimes/*/dependencies; do
    if [[ -x "$candidate/node/bin/node" && -d "$candidate/node/node_modules" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

DEPS_ROOT="${CODEX_DEPS_ROOT:-$(resolve_deps_root)}"
NODE_BIN="${CODEX_NODE_BIN:-$DEPS_ROOT/node/bin/node}"
NODE_MODULES_DIR="${CODEX_NODE_MODULES:-$DEPS_ROOT/node/node_modules}"

export NODE_PATH="$NODE_MODULES_DIR${NODE_PATH:+:$NODE_PATH}"

"$NODE_BIN" "$SCRIPT_DIR/scan.cjs" "$@"

if [[ -f "$SCRIPT_DIR/.sync.json" ]]; then
  "$NODE_BIN" "$SCRIPT_DIR/sync-report.cjs"
fi
