#!/usr/bin/env node

// Re-runs the Claude vision check on every currently-qualifying listing's
// already-cached photos — no Bright Data re-fetch needed, just Anthropic API
// calls against photo URLs already in state.json. Picks up: confidence-gated
// kitchen/stove classification (a low-confidence guess is now treated as
// unknown instead of trusted as fact), and the new garden/living-room-size
// signals, none of which existed when these listings were first classified.
//
// Re-evaluates each listing afterward, so a previously-qualifying listing
// whose kitchen layout was only a shaky guess can now correctly drop out.
// Saves state after every listing so an interruption doesn't lose progress.

const { loadConfig, loadState, buildReport, saveReport, statePath } = require("./scan.cjs");
const { classifyKitchenPhotos } = require("./lib/vision.cjs");
const { evaluateListing } = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

async function main() {
  const config = loadConfig();
  const state = loadState();
  const runAt = new Date().toISOString();

  const targets = Object.entries(state.catalog).filter(([, entry]) => entry.qualifies);
  console.log(`Re-running vision on ${targets.length} currently-qualifying listings...`);

  let updated = 0;
  let stillQualifying = 0;
  let failed = 0;

  for (const [entryId, entry] of targets) {
    try {
      const visionResult = await classifyKitchenPhotos(entry.listing.photos);
      const commuteResult = { commutes: entry.commute };
      const evaluation = evaluateListing(entry.listing, visionResult, commuteResult, config.profile);

      state.catalog[entryId] = {
        ...evaluation,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: runAt,
        lastSourceName: entry.lastSourceName,
      };

      updated += 1;
      if (evaluation.qualifies) {
        stillQualifying += 1;
      } else {
        console.log(`  now excluded: ${entry.listing.title} — ${evaluation.reasons.join("; ")}`);
      }

      writeJson(statePath, state);
    } catch (error) {
      failed += 1;
      console.warn(`  failed, left as-is: ${entry.listing.title} — ${error.message}`);
    }
  }

  const report = buildReport(state, runAt, config, []);
  saveReport(report);

  console.log(
    `Done. ${updated} re-classified (${stillQualifying} still qualify), ${failed} failed. ` +
      `Catalog now: ${report.topListings.length + report.earlyActionListings.length} qualifying, ${report.excludedListings.length} excluded.`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
