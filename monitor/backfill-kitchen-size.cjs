#!/usr/bin/env node

// One-off backfill: adds real kitchenSize data to qualifying catalog entries
// that predate the kitchenSize vision field (everything before commit
// fc28f8e). Re-runs classifyKitchenPhotos to get kitchenSize/confidence, but
// reuses the cached kitchenLayout/gasStove/hasGarden/livingRoomSmall and
// cached commute data as-is rather than re-spending that vision/Google
// budget for data that hasn't changed. Only targets entries missing
// kitchenSize, so it's safe to re-run — resumes wherever a previous
// interrupted run left off. Saves state after every listing.

const { loadConfig, loadState, buildReport, saveReport, statePath } = require("./scan.cjs");
const { classifyKitchenPhotos } = require("./lib/vision.cjs");
const { evaluateListing } = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

async function main() {
  const config = loadConfig();
  const state = loadState();
  const runAt = new Date().toISOString();

  const targets = Object.entries(state.catalog).filter(
    ([, entry]) => entry.qualifies && entry.listing && entry.kitchenSize === undefined
  );
  console.log(`Backfilling kitchen size for ${targets.length} qualifying listings...`);

  let updated = 0;
  let stillQualifying = 0;
  let large = 0;
  let small = 0;
  let failed = 0;

  for (const [entryId, entry] of targets) {
    try {
      const fresh = await classifyKitchenPhotos(entry.listing.photos || []);

      const visionResult = {
        kitchenVisible: entry.kitchenLayout !== "unknown",
        kitchenLayout: entry.kitchenLayout,
        kitchenConfidence: "high",
        kitchenSize: fresh.kitchenSize,
        kitchenSizeConfidence: fresh.kitchenSizeConfidence,
        gasStove: entry.gasStove,
        stoveConfidence: "high",
        hasGarden: entry.hasGarden,
        gardenConfidence: entry.hasGarden ? "high" : "low",
        livingRoomSmall: entry.livingRoomSmall,
        livingRoomConfidence: "high",
        notes: entry.visionNotes || "",
      };

      const commuteResult = {
        commutes: entry.commute || {},
        origin: { lat: entry.listing.lat, lng: entry.listing.lng, neighborhood: entry.listing.neighborhood },
      };

      const evaluation = evaluateListing(entry.listing, visionResult, commuteResult, config.profile);

      state.catalog[entryId] = {
        ...evaluation,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        lastSourceName: entry.lastSourceName,
        lastRevalidatedAt: entry.lastRevalidatedAt,
        lastRevalidatedLogicVersion: entry.lastRevalidatedLogicVersion,
      };

      updated += 1;
      if (evaluation.qualifies) stillQualifying += 1;
      else console.log(`  now excluded (vision non-determinism on re-check): ${entry.listing.title} — ${evaluation.reasons.join("; ")}`);
      if (evaluation.kitchenSize === "large") large += 1;
      if (evaluation.kitchenSize === "small") small += 1;

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
    `Done. ${updated} backfilled (${stillQualifying} still qualify, ${large} large kitchens, ${small} small), ${failed} failed. ` +
      `Catalog now: ${report.topListings.length} qualifying, ${report.excludedListings.length} excluded.`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
