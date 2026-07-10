#!/usr/bin/env node

// One-off backfill: re-fetches qualifying listings that predate the
// neighborhood field (only available from a fresh page load, not anything
// already cached) and re-evaluates them against the current profile (budget
// floor, Gowanus exclusion, rank score). Only targets entries still missing
// neighborhood, so this is safe to re-run — it picks up wherever a previous
// interrupted/partial run left off instead of re-fetching everything again.
//
// Reuses the cached kitchen-vision result instead of re-classifying photos,
// so this doesn't re-spend the Anthropic vision budget for data that hasn't
// changed. Saves state after every listing rather than only at the end, so
// an interruption partway through doesn't lose already-completed work.

const path = require("path");
const { chromium } = require("playwright");
const { loadConfig, loadState, buildReport, saveReport, statePath } = require("./scan.cjs");
const { extractListingDetail, resolveChromeExecutable, BotChallengeError, ExtractionIncompleteError } = require("./lib/adapters.cjs");
const { computeCommutes } = require("./lib/geo.cjs");
const { evaluateListing } = require("./lib/scoring.cjs");
const { writeJson } = require("./lib/util.cjs");

const workspaceRoot = path.resolve(__dirname, "..");
const outputPaths = {
  rootDir: workspaceRoot,
  screenshotDir: path.join(workspaceRoot, "monitor-output", "screenshots"),
};

async function main() {
  const config = loadConfig();
  const state = loadState();
  const runAt = new Date().toISOString();

  const targets = Object.entries(state.catalog).filter(([, entry]) => entry.qualifies && !entry.listing.neighborhood);
  console.log(`Reclassifying ${targets.length} qualifying listings still missing neighborhood data...`);

  const browser = await chromium.launch({ executablePath: resolveChromeExecutable() || undefined, headless: true });

  let updated = 0;
  let stillQualifying = 0;
  let failed = 0;

  for (const [entryId, entry] of targets) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1600 }, javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      const candidate = {
        url: entry.listing.url,
        title: entry.listing.title,
        searchSnippet: entry.listing.description || "",
        cardImage: entry.listing.photos?.[0] || "",
      };
      const details = await extractListingDetail(page, candidate, config, outputPaths);
      const merged = { ...candidate, ...details };

      const visionResult = {
        kitchenVisible: entry.kitchenLayout !== "unknown",
        kitchenLayout: entry.kitchenLayout,
        gasStove: entry.gasStove,
        notes: entry.visionNotes || "",
      };

      const commuteResult = merged.address ? await computeCommutes(merged.address, config.destinations) : null;

      const evaluation = evaluateListing(merged, visionResult, commuteResult, config.profile);
      if (!merged.address) {
        evaluation.reasons.push("No street address parsed; commute not calculated");
      }

      state.catalog[entryId] = {
        ...evaluation,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: runAt,
        lastSourceName: entry.lastSourceName,
      };

      updated += 1;
      if (evaluation.qualifies) stillQualifying += 1;
      else console.log(`  now excluded: ${merged.title} — ${evaluation.reasons.join("; ")}`);

      writeJson(statePath, state);
    } catch (error) {
      failed += 1;
      if (error instanceof BotChallengeError || error instanceof ExtractionIncompleteError) {
        console.warn(`  transient, left as-is (will retry next run): ${entry.listing.title} — ${error.message}`);
      } else {
        console.warn(`  failed, left as-is: ${entry.listing.title} — ${error.message}`);
      }
    } finally {
      await context.close();
    }
  }

  await browser.close();

  state.lastRunAt = runAt;
  writeJson(statePath, state);
  const report = buildReport(state, runAt, config, []);
  saveReport(report);

  console.log(
    `Done. ${updated} reclassified (${stillQualifying} still qualify), ${failed} left unchanged for retry. ` +
      `Catalog now: ${report.topListings.length} qualifying, ${report.excludedListings.length} excluded.`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
