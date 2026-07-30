#!/usr/bin/env node

// One-off: manually ingest a single listing URL through the same pipeline
// a normal scan uses (geocode/commute, vision classification, evaluateListing)
// instead of waiting for it to surface via search-result pagination. Useful
// for a brand-new listing (e.g. "Days on market 1 day") that hasn't been
// scanned yet, or one that ranks outside the pages a normal run fetches.

const {
  loadConfig,
  loadState,
  createPersistentContext,
  inspectListing,
  buildReport,
  saveReport,
  statePath,
} = require("./scan.cjs");
const { writeJson } = require("./lib/util.cjs");

const url = process.argv[2];
if (!url) {
  console.error("Usage: node add-listing.cjs <streeteasy-url>");
  process.exit(1);
}

async function main() {
  const config = loadConfig();
  const state = loadState();
  const runAt = new Date().toISOString();

  const entryId = url.split("?")[0];
  const candidate = { url: entryId, title: "", searchSnippet: "", cardImage: "" };

  const context = await createPersistentContext(config);
  let entry;
  try {
    const page = await context.newPage();
    try {
      entry = await inspectListing(candidate, page, config, runAt);
    } finally {
      await page.close();
    }
  } finally {
    await context.close();
  }

  entry.lastSourceName = "Manual add";
  state.catalog[entryId] = entry;
  writeJson(statePath, state);

  const report = buildReport(state, state.lastRunAt || runAt, config, []);
  saveReport(report);

  console.log(
    `Added: ${entry.listing.title} — qualifies: ${entry.qualifies}` +
      (entry.qualifies ? "" : ` — reasons: ${entry.reasons.join("; ")}`)
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
