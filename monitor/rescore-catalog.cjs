#!/usr/bin/env node

// One-off: recompute rankScore/rankBreakdown for every catalog entry using
// the current scoring.cjs (weights and/or dimensions changed) against
// already-cached commute/vision data — no Bright Data/Google/Anthropic
// calls. Existing entries have no kitchenSize field yet (that classification
// didn't exist when they were vision-checked), so rankBreakdown's
// kitchenSizeScore(undefined) correctly falls through to the neutral 50,
// same treatment as "standard"/unclassifiable, until each listing is next
// vision-classified.

const { loadState, statePath } = require("./scan.cjs");
const { rankBreakdown } = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

const state = loadState();
let updated = 0;

for (const entry of Object.values(state.catalog)) {
  if (!entry.listing) continue;
  const breakdown = rankBreakdown(
    entry.commute || {},
    entry.neighborhoodTier,
    entry.listing.sqft,
    entry.listing.bedrooms,
    entry.livingRoomSmall,
    entry.kitchenSize
  );
  entry.rankScore = breakdown.total;
  entry.rankBreakdown = breakdown;
  updated += 1;
}

writeJson(statePath, state);
console.log(`Rescored ${updated} catalog entries with the 6-dimension weighting.`);
