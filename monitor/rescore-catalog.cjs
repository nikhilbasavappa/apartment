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
const {
  rankBreakdown,
  extractBuildingType,
  isGroundFloorUnit,
  extractOutdoorSpaceTypes,
  hasPrivateGardenText,
  hasSpaciousLivingRoomText,
  hasSpaciousKitchenText,
  hasSmallKitchenText,
} = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

const state = loadState();
let updated = 0;

for (const entry of Object.values(state.catalog)) {
  if (!entry.listing) continue;

  const bodyText = entry.listing.bodyText;
  const buildingType = extractBuildingType(bodyText);
  const isCondo = /^condo(minium)?$/i.test(buildingType || "");
  const isGroundFloor = isGroundFloorUnit(entry.listing.title);
  entry.buildingType = buildingType;
  entry.isCondo = isCondo;
  entry.isGroundFloor = isGroundFloor;

  // Text overrides layered on top of whatever's already cached from the
  // last real vision pass — same effect as evaluateListing's own gating
  // without needing to re-call vision, since the cached value already IS
  // the vision-gated fallback these overrides compose with.
  const outdoorSpaceTypes = extractOutdoorSpaceTypes(bodyText);
  entry.hasGarden = outdoorSpaceTypes.length > 0 ? hasPrivateGardenText(bodyText) : entry.hasGarden;
  entry.livingRoomSmall = hasSpaciousLivingRoomText(bodyText) ? false : entry.livingRoomSmall;
  entry.kitchenSize = hasSpaciousKitchenText(bodyText)
    ? "large"
    : hasSmallKitchenText(bodyText)
      ? "small"
      : entry.kitchenSize;

  const breakdown = rankBreakdown(
    entry.commute || {},
    entry.neighborhoodTier,
    entry.listing.sqft,
    entry.listing.bedrooms,
    entry.livingRoomSmall,
    entry.kitchenSize,
    isCondo,
    entry.listing.price,
    isGroundFloor
  );
  entry.rankScore = breakdown.total;
  entry.rankBreakdown = breakdown;
  updated += 1;
}

writeJson(statePath, state);
console.log(`Rescored ${updated} catalog entries with the 9-dimension weighting plus text-based corroboration.`);
