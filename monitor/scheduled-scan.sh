#!/usr/bin/env bash
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$SCRIPT_DIR/scheduled-scan.log"
RUN_LOG="$(mktemp)"
trap 'rm -f "$RUN_LOG"' EXIT

cd "$REPO_ROOT"

# Wait for real network connectivity before starting. launchd can fire this
# right as the machine wakes from sleep, before WiFi has actually
# reconnected — Bright Data's own retry/backoff (~3.5s total across 3
# retries) isn't built to outlast a 10-30s WiFi reconnect window, so both
# the search fetch and every listing fetch fail outright until the network
# comes back. Poll a well-known, highly-reliable host (not Bright Data
# itself, so a Bright Data-side outage isn't misread as "network down")
# for up to 90s before giving up on this run entirely.
NETWORK_WAIT_MAX=90
waited=0
until curl -s -m 5 -o /dev/null https://1.1.1.1; do
  if [[ "$waited" -ge "$NETWORK_WAIT_MAX" ]]; then
    echo "=== Scan skipped at $(date): no network after ${NETWORK_WAIT_MAX}s wait ===" >> "$LOG_FILE"
    exit 0
  fi
  sleep 3
  waited=$((waited + 3))
done

echo "=== Scan started at $(date) ===" | tee -a "$LOG_FILE" "$RUN_LOG" >/dev/null

# Backgrounded with a watchdog instead of a plain foreground pipe: three
# separate multi-hour hangs happened this week (a network blip mid-run
# leaving some fetch() stalled forever with no default timeout — most of
# those now have one, but there's no guarantee the next hang looks the
# same). Without a wall-clock ceiling, a hang like that just runs silently
# until a human happens to notice the site is stale. 90 minutes is
# generous headroom above the normal 10-70 minute range.
node "$SCRIPT_DIR/scan.cjs" > >(tee -a "$LOG_FILE" "$RUN_LOG") 2>&1 &
SCAN_PID=$!

SCAN_TIMEOUT_SECONDS=$((90 * 60))
waited_for_scan=0
while kill -0 "$SCAN_PID" 2>/dev/null; do
  if [[ "$waited_for_scan" -ge "$SCAN_TIMEOUT_SECONDS" ]]; then
    echo "SCAN_TIMEOUT: scan.cjs exceeded ${SCAN_TIMEOUT_SECONDS}s (PID $SCAN_PID) — killing" | tee -a "$LOG_FILE" "$RUN_LOG" >/dev/null
    kill -9 "$SCAN_PID" 2>/dev/null || true
    break
  fi
  sleep 30
  waited_for_scan=$((waited_for_scan + 30))
done

wait "$SCAN_PID" 2>/dev/null
SCAN_EXIT_CODE=$?

# Three independent signals of a systemically broken run (Bright Data outage /
# bad credentials / StreetEasy layout change), not real data — don't publish
# either case over good existing data:
#   1. scan.cjs crashed outright (an uncaught exception), or the watchdog
#      above killed it for running too long — this used to slip through
#      silently: the report file never gets touched by a run that crashes
#      or hangs this way, so the checks below saw only old, good-looking
#      data and "no changes to commit" was the only trace, no notification
#      at all.
#   2. The search page itself yielded nothing (blocked before reaching any
#      listing at all).
#   3. Every new listing failed to yield both a rent and an address.
if [[ "$SCAN_EXIT_CODE" != "0" ]]; then
  BROKEN="yes"
elif grep -q "ZERO_SEARCH_RESULTS" "$RUN_LOG"; then
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
  osascript -e 'display notification "Scan looked broken — check monitor/scheduled-scan.log (Bright Data credentials/balance, a StreetEasy layout change, or a hung/timed-out run are the likely causes)" with title "Future Elmo'"'"'s World"' >> "$LOG_FILE" 2>&1 || true
  echo "Run looked systemically broken (Bright Data issue or site change?) — not committing." >> "$LOG_FILE"
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
