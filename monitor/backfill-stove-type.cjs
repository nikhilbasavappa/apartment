#!/usr/bin/env node

// One-off backfill: re-runs vision classification to get real stoveType
// data (gas/smoothElectric/coilElectric) for qualifying listings that
// predate this distinction — everything before commit 9266f24 only ever
// recorded a binary gasStove yes/no, which couldn't tell a coil range from
// a smooth-top one. Reuses the cached kitchenLayout/kitchenSize/hasGarden/
// livingRoomSmall/commute data as-is (no Google re-call, no re-spending
// vision budget on data that hasn't changed) and calls evaluateListing
// (not just rankBreakdown) since a coil-electric result can flip qualifies
// from true to false — this needs the real hard-filter re-check, unlike
// the kitchen-size backfill which only ever affected ranking.

const { loadConfig, loadState, buildReport, saveReport, statePath } = require("./scan.cjs");
const { classifyKitchenPhotos } = require("./lib/vision.cjs");
const { evaluateListing } = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

async function main() {
  const config = loadConfig();
  const state = loadState();
  const runAt = new Date().toISOString();

  const targets = Object.entries(state.catalog).filter(
    ([, entry]) => entry.qualifies && entry.listing && entry.stoveType === undefined
  );
  console.log(`Backfilling stove type for ${targets.length} qualifying listings...`);

  let updated = 0;
  let stillQualifying = 0;
  let coilExcluded = 0;
  let gas = 0;
  let smoothElectric = 0;
  let failed = 0;

  for (const [entryId, entry] of targets) {
    try {
      const fresh = await classifyKitchenPhotos(entry.listing.photos || []);

      const visionResult = {
        kitchenVisible: entry.kitchenLayout !== "unknown",
        kitchenLayout: entry.kitchenLayout,
        kitchenConfidence: "high",
        kitchenSize: entry.kitchenSize,
        kitchenSizeConfidence: "high",
        stoveType: fresh.stoveType,
        stoveConfidence: fresh.stoveConfidence,
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
      if (evaluation.stoveType === "coilElectric") coilExcluded += 1;
      if (evaluation.stoveType === "gas") gas += 1;
      if (evaluation.stoveType === "smoothElectric") smoothElectric += 1;
      if (!evaluation.qualifies) {
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
    `Done. ${updated} backfilled (${stillQualifying} still qualify, ${coilExcluded} excluded for coil electric, ` +
      `${gas} gas, ${smoothElectric} smooth electric), ${failed} failed. ` +
      `Catalog now: ${report.topListings.length} qualifying, ${report.excludedListings.length} excluded.`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
