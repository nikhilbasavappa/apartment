#!/usr/bin/env node

// One-off backfill: re-runs geocoding + commute computation for every
// currently-qualifying listing. Needed after changing a destination address
// (LIC friend moved to a specific Hunters Point address) or adding logic
// that depends on lat/lng (UWS street-number tiering) that older cached
// entries never captured. Google Geocoding/Directions only — no Bright Data,
// no vision re-run, so this is cheap and fast compared to reclassify.cjs.
//
// Only targets qualifying entries, same reasoning as reclassify.cjs: an
// already-excluded listing can't be un-excluded by this, and the one new
// way this run can exclude something (too far north on UWS) only matters
// for entries that were qualifying in the first place.

const { loadConfig, loadState, buildReport, saveReport, statePath } = require("./scan.cjs");
const { computeCommutes } = require("./lib/geo.cjs");
const { evaluateListing } = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

async function main() {
  const config = loadConfig();
  const state = loadState();
  const runAt = new Date().toISOString();

  const targets = Object.entries(state.catalog).filter(([, entry]) => entry.qualifies);
  console.log(`Re-geocoding ${targets.length} currently-qualifying listings...`);

  let updated = 0;
  let stillQualifying = 0;
  let failed = 0;

  for (const [entryId, entry] of targets) {
    try {
      const visionResult = {
        kitchenVisible: entry.kitchenLayout !== "unknown",
        kitchenLayout: entry.kitchenLayout,
        kitchenConfidence: "high",
        gasStove: entry.gasStove,
        stoveConfidence: "high",
        hasGarden: entry.hasGarden,
        gardenConfidence: entry.hasGarden ? "high" : "low",
        livingRoomSmall: entry.livingRoomSmall,
        livingRoomConfidence: "high",
        notes: entry.visionNotes || "",
      };

      const commuteResult = entry.listing.address
        ? await computeCommutes(entry.listing.address, config.destinations)
        : null;

      const evaluation = evaluateListing(entry.listing, visionResult, commuteResult, config.profile);
      if (!entry.listing.address) {
        evaluation.reasons.push("No street address parsed; commute not calculated");
      }

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

  state.lastRunAt = runAt;
  writeJson(statePath, state);

  const report = buildReport(state, runAt, config, []);
  saveReport(report);

  console.log(
    `Done. ${updated} re-geocoded (${stillQualifying} still qualify), ${failed} failed. ` +
      `Catalog now: ${report.topListings.length} qualifying, ${report.excludedListings.length} excluded.`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
