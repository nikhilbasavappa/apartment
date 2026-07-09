#!/usr/bin/env bash
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$SCRIPT_DIR/scheduled-scan.log"
RUN_LOG="$(mktemp)"
trap 'rm -f "$RUN_LOG"' EXIT

cd "$REPO_ROOT"

echo "=== Scan started at $(date) ===" | tee -a "$LOG_FILE" "$RUN_LOG" >/dev/null
node "$SCRIPT_DIR/scan.cjs" 2>&1 | tee -a "$LOG_FILE" "$RUN_LOG" >/dev/null

# Two independent signals of a systemically broken run (StreetEasy bot wall /
# stale profile), not real data — don't publish either case over good
# existing data:
#   1. The search page itself yielded nothing (blocked before reaching any
#      listing at all).
#   2. Every new listing failed to yield both a rent and an address.
if grep -q "ZERO_SEARCH_RESULTS" "$RUN_LOG"; then
  BROKEN="yes"
else
  BROKEN=$(node -e '
    const fs = require("fs");
    try {
      const report = JSON.parse(fs.readFileSync("monitor-output/latest-report.json", "utf8"));
      const fresh = report.newListings || [];
      if (fresh.length === 0) { console.log("no"); process.exit(0); }
      const allBroken = fresh.every((entry) => {
        const reasons = entry.reasons || [];
        const noRent = reasons.some((r) => r.includes("Rent could not be confirmed"));
        const noAddress = reasons.some((r) => r.includes("No street address parsed"));
        return noRent && noAddress;
      });
      console.log(allBroken ? "yes" : "no");
    } catch (error) {
      console.log("no");
    }
  ')
fi

if [[ "$BROKEN" == "yes" ]]; then
  osascript -e 'display notification "StreetEasy session likely expired. Run: node monitor/bootstrap-session.cjs" with title "Future Elmo'"'"'s World"' >> "$LOG_FILE" 2>&1 || true
  echo "Run looked systemically broken (expired session?) — not committing." >> "$LOG_FILE"
  git checkout -- monitor-output/ >> "$LOG_FILE" 2>&1 || true
  exit 0
fi

if ! git diff --quiet -- monitor-output/ || ! git diff --cached --quiet -- monitor-output/; then
  git add monitor-output/ >> "$LOG_FILE" 2>&1
  git commit -m "Automated scan $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG_FILE" 2>&1
  git push origin main >> "$LOG_FILE" 2>&1
  echo "Committed and pushed fresh scan results." >> "$LOG_FILE"
else
  echo "No changes to commit." >> "$LOG_FILE"
fi

echo "=== Scan finished at $(date) ===" >> "$LOG_FILE"
