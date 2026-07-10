#!/usr/bin/env node

const path = require("path");
const { chromium } = require("playwright");
const {
  BotChallengeError,
  buildPageUrl,
  clearStaleSingletonLock,
  extractListingDetail,
  extractSearchListings,
  resolveChromeExecutable,
} = require("./lib/adapters.cjs");
const { computeCommutes } = require("./lib/geo.cjs");
const { generateHtmlReport, generateMarkdownReport } = require("./lib/report.cjs");
const { sendNotifications } = require("./lib/notify.cjs");
const { evaluateListing } = require("./lib/scoring.cjs");
const { classifyKitchenPhotos } = require("./lib/vision.cjs");
const fs = require("fs");
const { ensureDir, formatTimestamp, loadEnvFile, randomDelay, readJson, writeJson, writeText } = require("./lib/util.cjs");

const workspaceRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(workspaceRoot, "monitor-output");
const screenshotDir = path.join(outputRoot, "screenshots");
const statePath = path.join(outputRoot, "state.json");
const summaryPath = path.join(outputRoot, "latest-summary.md");
const htmlPath = path.join(outputRoot, "latest-report.html");
const jsonPath = path.join(outputRoot, "latest-report.json");
const jsPath = path.join(outputRoot, "latest-report.js");
const configPath = path.join(__dirname, "config.json");
const browserProfileDir = path.join(__dirname, ".browser-profile");

loadEnvFile(path.join(__dirname, ".env"));

const defaultProfile = {
  startDate: "2026-10-13",
  budgetMin: 3500,
  budgetMax: 7000,
  bedroomsMin: 1,
};

const defaultDestinations = {
  office: "Lexington Ave & E 53rd St, New York, NY",
  prospectHeights: "Prospect Heights, Brooklyn, NY",
  longIslandCity: "Long Island City, Queens, NY",
  morningsideHeights: "Morningside Heights, New York, NY",
};

function loadConfig() {
  const config = readJson(configPath, null);
  if (!config) {
    throw new Error(`Missing config file at ${configPath}`);
  }

  return {
    ...config,
    destinations: { ...defaultDestinations, ...(config.destinations || {}) },
    profile: { ...defaultProfile, ...(config.profile || {}) },
  };
}

function loadState() {
  return readJson(statePath, {
    catalog: {},
    lastRunAt: null,
    version: 2,
  });
}

function pruneCatalog(state, retainDays) {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;

  Object.keys(state.catalog).forEach((key) => {
    const entry = state.catalog[key];
    if (!entry.lastSeenAt) return;
    if (new Date(entry.lastSeenAt).getTime() < cutoff) {
      delete state.catalog[key];
    }
  });
}

function officeMinutes(entry) {
  return entry.commute?.office?.minutes ?? Number.POSITIVE_INFINITY;
}

function buildReport(state, runAt, config, newListings) {
  const catalogEntries = Object.values(state.catalog);

  const topListings = catalogEntries
    .filter((entry) => entry.qualifies)
    .sort((a, b) => officeMinutes(a) - officeMinutes(b))
    .slice(0, 24);

  const excludedListings = catalogEntries
    .filter((entry) => !entry.qualifies)
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
    .slice(0, 40);

  return {
    excludedListings,
    htmlPath,
    jsonPath,
    newListings: newListings.filter((entry) => entry.qualifies).sort((a, b) => officeMinutes(a) - officeMinutes(b)),
    runAt,
    sourcesConfigured: config.sources.filter((source) => source.enabled && source.url).length,
    summaryPath,
    topListings,
  };
}

function toClientReport(report) {
  const serializeEntry = (entry) => ({
    commute: entry.commute,
    gasStove: entry.gasStove,
    kitchenLayout: entry.kitchenLayout,
    listing: {
      address: entry.listing.address,
      bathrooms: entry.listing.bathrooms,
      bedrooms: entry.listing.bedrooms,
      description: entry.listing.description,
      externalScreenshot: entry.listing.externalScreenshot,
      photos: entry.listing.photos || [],
      price: entry.listing.price,
      sqft: entry.listing.sqft,
      title: entry.listing.title,
      url: entry.listing.url,
      washerDryer: entry.listing.washerDryer,
    },
    visionNotes: entry.visionNotes,
  });

  const serializeExcluded = (entry) => ({
    listing: {
      address: entry.listing.address,
      price: entry.listing.price,
      title: entry.listing.title,
      url: entry.listing.url,
    },
    reasons: entry.reasons || [],
  });

  return {
    excludedListings: report.excludedListings.map(serializeExcluded),
    newListings: report.newListings.map(serializeEntry),
    runAt: report.runAt,
    sourcesConfigured: report.sourcesConfigured,
    topListings: report.topListings.map(serializeEntry),
  };
}

function saveReport(report) {
  ensureDir(outputRoot);
  writeJson(jsonPath, report);
  writeText(jsPath, `window.__APARTMENT_REPORT__ = ${JSON.stringify(toClientReport(report), null, 2)};\n`);
  writeText(summaryPath, generateMarkdownReport(report));
  writeText(htmlPath, generateHtmlReport(report));
}

// A real persistent Chrome profile (history, cache, cookies, local storage —
// everything, not just an exported cookie jar) presents a far more
// convincing "long-lived real user" fingerprint to bot detection than a
// fresh context replaying a saved storageState every run. The profile is
// bootstrapped once interactively (see bootstrap-session.cjs) and reused
// here and on every future scheduled run.
function createPersistentContext(config) {
  const hasProfile = fs.existsSync(browserProfileDir) && fs.readdirSync(browserProfileDir).length > 0;

  if (!hasProfile) {
    console.warn(
      "No browser profile found. StreetEasy will likely block this run with a bot challenge.\n" +
        "Run `node monitor/bootstrap-session.cjs` once to solve it manually and build a trusted profile."
    );
  }

  ensureDir(browserProfileDir);
  clearStaleSingletonLock(browserProfileDir);

  return chromium.launchPersistentContext(browserProfileDir, {
    executablePath: resolveChromeExecutable() || undefined,
    headless: config.scanner.headless !== false,
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 1600 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--disable-dev-shm-usage",
    ],
  });
}

async function inspectListing(candidate, listingPage, config, runAt) {
  const details = await extractListingDetail(listingPage, candidate, config, {
    rootDir: outputRoot,
    screenshotDir,
  });

  const merged = { ...candidate, ...details };

  const [visionResult, commuteResult] = await Promise.all([
    classifyKitchenPhotos(merged.photos).catch((error) => {
      console.warn(`Vision classification failed for ${merged.url}: ${error.message}`);
      return null;
    }),
    merged.address
      ? computeCommutes(merged.address, config.destinations).catch((error) => {
          console.warn(`Commute lookup failed for ${merged.url}: ${error.message}`);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const evaluation = evaluateListing(merged, visionResult, commuteResult, config.profile);

  if (!merged.address) {
    evaluation.reasons.push("No street address parsed; commute not calculated");
  }

  return {
    ...evaluation,
    firstSeenAt: runAt,
    lastSeenAt: runAt,
  };
}

// StreetEasy paginates search results (?page=2, ?page=3, ...) rather than
// infinite-scrolling; a single page load only ever exposes a small slice
// (~11-20) of what can be several hundred total matches. Walk pages until
// one comes back with nothing new, or the configured cap is hit.
async function collectSearchCandidates(searchPage, sourceConfig, config) {
  const collected = [];
  const seenUrls = new Set();
  const maxCandidates = config.scanner.maxListingsPerSource || 20;
  const baseWait = config.scanner.waitAfterLoadMs || 1200;

  for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
    const pageUrl = buildPageUrl(sourceConfig.url, pageNumber);
    await searchPage.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await randomDelay(baseWait * 0.7, baseWait * 1.4);

    const pageResults = await extractSearchListings(searchPage, sourceConfig);
    const newOnes = pageResults.filter((item) => !seenUrls.has(item.url));

    if (!newOnes.length) break;

    newOnes.forEach((item) => {
      seenUrls.add(item.url);
      collected.push(item);
    });

    if (collected.length >= maxCandidates) break;

    // Pace like someone paging through results, not a script hammering
    // "next page" — the same treatment as between individual listings.
    await randomDelay(2500, 6000);
  }

  return collected;
}

async function inspectSource(sourceConfig, context, state, config, runAt, counters) {
  const searchPage = await context.newPage();
  const freshEntries = [];

  try {
    const searchResults = await collectSearchCandidates(searchPage, sourceConfig, config);
    if (!searchResults.length) {
      // Distinct, greppable signal: the search results page itself yielded
      // nothing, which usually means the bot wall blocked it before any
      // listing was ever reached — a stronger failure than a few individual
      // listings not parsing cleanly.
      console.warn(`ZERO_SEARCH_RESULTS: no listings found on search page for "${sourceConfig.name}"`);
    }
    const limitedResults = searchResults.slice(0, config.scanner.maxListingsPerSource || 20);
    let consecutiveChallenges = 0;

    for (const candidate of limitedResults) {
      const entryId = candidate.id || candidate.url;
      const existing = state.catalog[entryId];

      if (existing) {
        existing.lastSeenAt = runAt;
        existing.lastSourceName = sourceConfig.name;
        continue;
      }

      if (counters.newListingsInspected >= (config.scanner.maxNewListingsPerRun || 12)) {
        break;
      }

      // Pace like a person clicking through listings, not a script blasting
      // through them — a longer pause every so often too, like someone
      // taking a break to think about what they just saw.
      if (counters.newListingsInspected > 0) {
        const takingABreak = counters.newListingsInspected % 12 === 0;
        await randomDelay(...(takingABreak ? [18000, 35000] : [3000, 8000]));
      }

      const listingPage = await context.newPage();
      try {
        const catalogEntry = await inspectListing(candidate, listingPage, config, runAt);
        catalogEntry.lastSourceName = sourceConfig.name;

        state.catalog[entryId] = catalogEntry;
        freshEntries.push(catalogEntry);
        counters.newListingsInspected += 1;
        consecutiveChallenges = 0;
      } catch (error) {
        if (error instanceof BotChallengeError) {
          // Don't cache this as a permanent "excluded" record — we didn't
          // actually see the listing, we got a challenge page. Leaving it
          // out of the catalog means it's retried on a future run instead
          // of being wrongly marked as inspected-and-rejected forever.
          consecutiveChallenges += 1;
          console.warn(`BOT_CHALLENGE: ${error.message} (${consecutiveChallenges} in a row)`);

          if (consecutiveChallenges >= 3) {
            console.warn(
              "BOT_CHALLENGE: 3 in a row — stopping this run rather than burning through " +
                "the rest of the candidate list against a wall it's not going to get past."
            );
            // `finally` below still runs and closes listingPage before this
            // break actually exits the loop.
            break;
          }
        } else {
          state.catalog[entryId] = {
            commute: {},
            gasStove: "unknown",
            kitchenLayout: "unknown",
            listing: {
              ...candidate,
              description: candidate.searchSnippet || "",
              externalScreenshot: null,
              photos: [],
              url: candidate.url,
            },
            qualifies: false,
            reasons: [`Inspection failed: ${error.message}`],
            firstSeenAt: runAt,
            lastSeenAt: runAt,
            lastSourceName: sourceConfig.name,
          };
        }
      } finally {
        await listingPage.close();
      }
    }
  } finally {
    await searchPage.close();
  }

  return freshEntries;
}

async function main() {
  const config = loadConfig();
  const state = loadState();
  const runAt = new Date().toISOString();
  const activeSources = config.sources.filter((source) => source.enabled && source.url);

  ensureDir(outputRoot);
  ensureDir(screenshotDir);
  pruneCatalog(state, config.scanner.retainDays || 21);

  if (!activeSources.length) {
    const report = buildReport(state, runAt, config, []);
    saveReport(report);
    writeText(
      summaryPath,
      [
        "# Future Elmo's World Monitor",
        "",
        `Run time: ${formatTimestamp(runAt)}`,
        "No live sources are enabled yet.",
        "",
        "Add public saved-search URLs in monitor/config.json, set enabled to true, then rerun ./monitor/run-scan.sh.",
      ].join("\n")
    );
    console.log("No live sources enabled. Wrote an empty report scaffold.");
    return;
  }

  const context = await createPersistentContext(config);
  const counters = { newListingsInspected: 0 };
  const newListings = [];

  try {
    for (const source of activeSources) {
      const freshEntries = await inspectSource(source, context, state, config, runAt, counters);
      newListings.push(...freshEntries);
    }
  } finally {
    await context.close();
  }

  state.lastRunAt = runAt;
  writeJson(statePath, state);

  const report = buildReport(state, runAt, config, newListings);
  saveReport(report);
  sendNotifications(report, config);

  const qualifyingCount = newListings.filter((entry) => entry.qualifies).length;
  console.log(
    `Scan complete at ${formatTimestamp(runAt)}. ${newListings.length} new listings inspected, ${qualifyingCount} qualified. Report: ${htmlPath}`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
