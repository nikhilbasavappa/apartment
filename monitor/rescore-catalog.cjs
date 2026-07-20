#!/usr/bin/env node

// One-off: recompute rankScore/rankBreakdown for every catalog entry using
// the current scoring.cjs (weights and/or dimensions changed) against
// already-cached commute/vision/listing-text data — no Bright Data/Google/
// Anthropic calls. Also (re)derives buildingType/isCondo from each entry's
// cached bodyText, since that's pure text extraction with no API cost,
// unlike kitchenSize which requires an actual vision re-classification
// (see backfill-kitchen-size.cjs for that one). Existing entries missing a
// field entirely (e.g. kitchenSize on first run after that dimension
// shipped) correctly fall through rankBreakdown's scoring functions to
// their neutral default rather than erroring.

const { loadState, statePath } = require("./scan.cjs");
const { rankBreakdown, extractBuildingType } = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

const state = loadState();
let updated = 0;

for (const entry of Object.values(state.catalog)) {
  if (!entry.listing) continue;

  const buildingType = extractBuildingType(entry.listing.bodyText);
  const isCondo = /^condo(minium)?$/i.test(buildingType || "");
  entry.buildingType = buildingType;
  entry.isCondo = isCondo;

  const breakdown = rankBreakdown(
    entry.commute || {},
    entry.neighborhoodTier,
    entry.listing.sqft,
    entry.listing.bedrooms,
    entry.livingRoomSmall,
    entry.kitchenSize,
    isCondo
  );
  entry.rankScore = breakdown.total;
  entry.rankBreakdown = breakdown;
  updated += 1;
}

writeJson(statePath, state);
console.log(`Rescored ${updated} catalog entries with the 7-dimension weighting.`);
