#!/usr/bin/env node

// Publishes a read-only snapshot of starred listings (+ notes) for the
// "Shared Picks" tab — a static, self-contained JSON/JS pair anyone with
// the site link can view, independent of their own (empty) localStorage.
// Not live-synced: run this again and commit/push whenever the user wants
// their shared view refreshed, same manual-resync model as the earlier
// one-off Touring Route artifact, just folded into the real site this time.
//
// Usage: node monitor/build-shared-picks.cjs <path-to-feedback-export.json>
// (the file downloaded by the site's own "Export my stars & notes" button)

const fs = require("fs");
const path = require("path");
const { loadState } = require("./scan.cjs");
const { writeJson } = require("./lib/util.cjs");

const GONE_PATTERN = /delisted|rented|in contract|temporarily off market|no longer (listed|available)/i;

function isGone(entry) {
  return (entry.reasons || []).some((r) => GONE_PATTERN.test(r) && /auto-detected during periodic revalidation/.test(r));
}

async function main() {
  const feedbackPath = process.argv[2];
  if (!feedbackPath) {
    console.error("Usage: node monitor/build-shared-picks.cjs <path-to-feedback-export.json>");
    process.exit(1);
  }

  const feedback = JSON.parse(fs.readFileSync(feedbackPath, "utf8"));
  const state = loadState();
  const starred = feedback.filter((f) => f.starred);

  const entries = [];
  for (const f of starred) {
    const catalogEntry = state.catalog[f.url];
    if (!catalogEntry) {
      // Aged out of the catalog or never scanned — still worth showing with
      // whatever the user recorded, rather than silently dropping it.
      entries.push({
        title: f.title,
        url: f.url,
        note: f.note || "",
        status: f.unavailable ? "gone" : "unknown",
      });
      continue;
    }

    const status = f.unavailable || isGone(catalogEntry) ? "gone" : catalogEntry.qualifies ? "qualifying" : "excluded";

    entries.push({
      title: catalogEntry.listing.title,
      address: catalogEntry.listing.address,
      price: catalogEntry.listing.price,
      bedrooms: catalogEntry.listing.bedrooms,
      bathrooms: catalogEntry.listing.bathrooms,
      sqft: catalogEntry.listing.sqft,
      neighborhood: catalogEntry.listing.neighborhood,
      availableDate: catalogEntry.listing.availableDate,
      kitchenLayout: catalogEntry.kitchenLayout,
      stoveType: catalogEntry.stoveType,
      url: catalogEntry.listing.url,
      note: f.note || "",
      status,
      reasons: status === "excluded" ? catalogEntry.reasons : undefined,
    });
  }

  // Manually-added tour entries aren't in feedbackState at all (see
  // MANUAL_TOUR_STORAGE_KEY in app.js) and so can't come through the
  // feedback export — the user would need to also send that localStorage
  // key's contents for those to appear here. Not wired up yet; today this
  // only covers starred catalog listings.

  const payload = { updatedAt: new Date().toISOString(), entries };

  const outputDir = path.join(__dirname, "..", "monitor-output");
  writeJson(path.join(outputDir, "shared-picks.json"), payload);
  fs.writeFileSync(
    path.join(outputDir, "shared-picks.js"),
    `window.__SHARED_PICKS__ = ${JSON.stringify(payload, null, 2)};\n`
  );

  console.log(`Published ${entries.length} shared picks.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
