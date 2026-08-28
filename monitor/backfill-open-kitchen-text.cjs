#!/usr/bin/env node

// One-off backfill: re-runs evaluateListing for every catalog entry using
// the new hasOpenKitchenText text override (commit pending) — a listing's
// own copy explicitly saying "open kitchen" / "kitchen opens onto the
// living room" / "natural flow between the living space and kitchen" now
// overrides a wrong/uncertain vision "closed" call, symmetric to the
// existing hasSeparateKitchenText override.
//
// Prompted by 387 7th Avenue #2: vision confidently called an L-shaped
// corner kitchen "closed" with no wall actually visible in the photo,
// while the listing's own text said the layout "creates a natural flow
// between the living space and kitchen." A sweep of the full catalog
// found 81 other listings with the same gap — mostly plain "Open kitchen"
// claims (StreetEasy free text, or OpenIgloo's own structured amenity tag).
//
// No new network/vision calls — reuses each entry's already-resolved
// kitchenLayout/kitchenSize/stoveType/hasGarden/livingRoomSmall as a
// trusted ("high" confidence) stand-in vision result, same pattern as
// backfill-kitchen-livingroom-v2.cjs, so this only re-runs the text-override
// and hard-filter logic, not the (paid) vision classification itself.

const { loadConfig, loadState, buildReport, saveReport, statePath } = require("./scan.cjs");
const { evaluateListing, hasOpenKitchenText } = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

async function main() {
  const config = loadConfig();
  const state = loadState();

  // Skip anything the revalidation system has already flagged as removed/
  // delisted/status-changed — that's a live signal from lastRevalidatedAt,
  // not derivable from bodyText, and evaluateListing has no way to know
  // about it. Blindly re-evaluating from stale cached page text would
  // silently resurrect a listing that's genuinely gone (caught this the
  // hard way on the first attempt: 662 Pacific St #21M, correctly marked
  // "No longer available on StreetEasy" by revalidation, would have been
  // wrongly reinstated as qualifying).
  const isRevalidationRemoved = (entry) =>
    (entry.reasons || []).some((r) => /\(auto-detected during periodic revalidation\)/.test(r));

  // Further narrowed to only entries the text override would actually flip
  // (kitchenLayout not already open/semi-open, and the listing's own text
  // makes an explicit open-kitchen claim) — every other entry is left
  // completely untouched, even if re-running evaluateListing on it would
  // happen to produce a different result for some unrelated reason. Keeping
  // the blast radius to exactly what this fix is about, after the first
  // attempt's unrelated-scope mistake above.
  const entries = Object.entries(state.catalog).filter(([, entry]) => {
    if (!entry.listing || !entry.listing.bodyText) return false;
    if (entry.kitchenLayout === "open" || entry.kitchenLayout === "semi-open") return false;
    if (isRevalidationRemoved(entry)) return false;
    return hasOpenKitchenText(entry.listing.bodyText);
  });
  console.log(`Re-checking kitchen layout text override for ${entries.length} catalog entries...`);

  let changed = 0;
  let newlyQualifies = 0;

  for (const [entryId, entry] of entries) {
    const vision = {
      kitchenVisible: entry.kitchenLayout !== "unknown",
      kitchenLayout: entry.kitchenLayout,
      kitchenConfidence: "high",
      kitchenSize: entry.kitchenSize,
      kitchenSizeConfidence: "high",
      stoveType: entry.stoveType,
      stoveConfidence: "high",
      hasGarden: entry.hasGarden,
      gardenConfidence: entry.hasGarden ? "high" : "low",
      livingRoomSmall: entry.livingRoomSmall,
      livingRoomConfidence: "high",
      notes: entry.visionNotes || "",
    };
    const commuteResult = {
      commutes: entry.commute || {},
      origin: { lat: entry.listing.lat ?? null, lng: entry.listing.lng ?? null },
    };

    const wasQualifying = entry.qualifies;
    const oldLayout = entry.kitchenLayout;
    const fresh = evaluateListing(entry.listing, vision, commuteResult, config.profile);

    if (fresh.kitchenLayout !== oldLayout || fresh.qualifies !== wasQualifying) {
      changed++;
      if (!wasQualifying && fresh.qualifies) newlyQualifies++;
      console.log(
        `${fresh.qualifies ? "NOW QUALIFIES" : "updated"}: ${entry.listing.title || entryId} | kitchenLayout ${oldLayout} -> ${fresh.kitchenLayout}`
      );
    }

    state.catalog[entryId] = {
      ...entry,
      ...fresh,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      lastSourceName: entry.lastSourceName,
    };
  }

  writeJson(statePath, state);
  const report = buildReport(state, state.lastRunAt || new Date().toISOString(), config, []);
  saveReport(report);

  console.log(`Done. ${changed} entries changed, ${newlyQualifies} newly qualify.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
