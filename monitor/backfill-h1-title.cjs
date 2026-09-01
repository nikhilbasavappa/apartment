#!/usr/bin/env node

// One-off backfill: re-fetches the detail page for every Corcoran/OpenIgloo
// catalog entry and patches listing.title from the page's own <h1> (commit
// pending, adapters.cjs) — the search-card scrape (candidate.title) used to
// win priority, and on these two sources the whole result card is one big
// anchor, so candidate.title ended up being the entire card's text (badges,
// neighborhood, beds/baths, rating, price, all concatenated), e.g.
// "Verified Rent-stabilized Carroll Gardens · 2 beds, 1 bath 3.8 (3) 329
// Union Street #2B · New $4,400" instead of just "329 Union Street #2B".
//
// Deliberately does NOT call inspectListing/evaluateListing — this only
// needs a fresh static-HTML fetch for the <h1>, not a full re-extraction,
// so it doesn't re-spend the (paid) vision classification or commute
// geocoding calls for data that hasn't changed. Only the title field is
// touched; everything else on each entry (kitchenLayout, qualifies,
// rankScore, etc.) is left exactly as-is.

const { chromium } = require("playwright");
const { loadConfig, loadState, buildReport, saveReport, statePath } = require("./scan.cjs");
const { loadViaUnlocker, resolveChromeExecutable, isBotChallengePage } = require("./lib/adapters.cjs");
const { writeJson } = require("./lib/util.cjs");

async function main() {
  const config = loadConfig();
  const state = loadState();

  const targets = Object.entries(state.catalog).filter(
    ([, entry]) => entry.listing && (entry.listing.source === "corcoran" || entry.listing.source === "openigloo")
  );
  console.log(`Re-fetching H1 for ${targets.length} Corcoran/OpenIgloo entries...`);

  const browser = await chromium.launch({ executablePath: resolveChromeExecutable() || undefined, headless: true });
  const page = await browser.newPage();

  let updated = 0;
  let failed = 0;

  for (const [entryId, entry] of targets) {
    try {
      await loadViaUnlocker(page, entry.listing.url, config.scanner.waitAfterLoadMs);
      const raw = await page.evaluate(() => ({
        h1: document.querySelector("h1")?.innerText || "",
      }));
      if (isBotChallengePage(raw)) throw new Error("bot challenge page");

      const cleanTitle = raw.h1.trim();
      if (cleanTitle && cleanTitle !== entry.listing.title) {
        console.log(`${entry.listing.title} -> ${cleanTitle}`);
        state.catalog[entryId] = {
          ...entry,
          listing: { ...entry.listing, title: cleanTitle },
        };
        updated++;
      }
    } catch (error) {
      failed++;
      console.warn(`Failed for ${entry.listing.url}: ${error.message}`);
    }
  }

  await browser.close();

  writeJson(statePath, state);
  const report = buildReport(state, state.lastRunAt || new Date().toISOString(), config, []);
  saveReport(report);

  console.log(`Done. ${updated} titles fixed, ${failed} failed.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
