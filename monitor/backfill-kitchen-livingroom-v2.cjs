#!/usr/bin/env node

// One-off backfill: re-runs vision classification to get real kitchenSize
// and livingRoomSmall data using the tightened prompts from commits
// 6e74967/a69b3e8 — the old prompts conflated a large kitchen island with
// actual kitchen size, and judged living room size by furniture-to-room
// ratio rather than actual floor area, both confirmed wrong by direct photo
// inspection on 20 Rockwell Place #2627Q. Every currently-qualifying
// listing predates these fixes, so this re-checks all of them, not just
// ones missing a field.
//
// Keeps cached kitchenLayout/stoveType as trusted ("high" confidence) since
// neither of those prompts changed — only takes the fresh kitchenSize and
// livingRoomSmall from the new vision call, same selective-trust pattern as
// backfill-stove-type.cjs. hasGarden still goes through evaluateListing's
// own text-based override regardless of what vision says here, since that
// (commit a69b3e8) is already more reliable than either vision pass.
//
// Uses evaluateListing (not just rankBreakdown) since a kitchen that now
// reads as "closed"/"galley" would newly exclude a listing — needs the real
// hard-filter re-check, same as the stove backfill.

const { loadConfig, loadState, buildReport, saveReport, statePath } = require("./scan.cjs");
const { classifyKitchenPhotos } = require("./lib/vision.cjs");
const { evaluateListing } = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

async function main() {
  const config = loadConfig();
  const state = loadState();
  const runAt = new Date().toISOString();

  const targets = Object.entries(state.catalog).filter(([, entry]) => entry.qualifies && entry.listing);
  console.log(`Re-checking kitchen/living-room size for ${targets.length} qualifying listings...`);

  let updated = 0;
  let stillQualifying = 0;
  let kitchenSizeChanged = 0;
  let livingRoomChanged = 0;
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
        stoveType: entry.stoveType,
        stoveConfidence: "high",
        hasGarden: entry.hasGarden,
        gardenConfidence: entry.hasGarden ? "high" : "low",
        livingRoomSmall: fresh.livingRoomSmall,
        livingRoomConfidence: fresh.livingRoomConfidence,
        notes: fresh.notes || entry.visionNotes || "",
      };

      const commuteResult = {
        commutes: entry.commute || {},
        origin: { lat: entry.listing.lat, lng: entry.listing.lng, neighborhood: entry.listing.neighborhood },
      };

      const evaluation = evaluateListing(entry.listing, visionResult, commuteResult, config.profile);

      if (evaluation.kitchenSize !== entry.kitchenSize) kitchenSizeChanged += 1;
      if (evaluation.livingRoomSmall !== entry.livingRoomSmall) livingRoomChanged += 1;

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
      else console.log(`  now excluded: ${entry.listing.title} — ${evaluation.reasons.join("; ")}`);

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
    `Done. ${updated} re-checked (${stillQualifying} still qualify), ${kitchenSizeChanged} kitchen size changes, ` +
      `${livingRoomChanged} living room size changes, ${failed} failed. ` +
      `Catalog now: ${report.topListings.length} qualifying, ${report.excludedListings.length} excluded.`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
