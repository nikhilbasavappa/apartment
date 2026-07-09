#!/usr/bin/env node

const path = require("path");
const { chromium } = require("playwright");
const { extractListingDetail, extractSearchListings, resolveChromeExecutable } = require("./lib/adapters.cjs");
const { computeCommutes } = require("./lib/geo.cjs");
const { generateHtmlReport, generateMarkdownReport } = require("./lib/report.cjs");
const { sendNotifications } = require("./lib/notify.cjs");
const { evaluateListing } = require("./lib/scoring.cjs");
const { classifyKitchenPhotos } = require("./lib/vision.cjs");
const fs = require("fs");
const { ensureDir, formatTimestamp, loadEnvFile, readJson, writeJson, writeText } = require("./lib/util.cjs");

const workspaceRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(workspaceRoot, "monitor-output");
const screenshotDir = path.join(outputRoot, "screenshots");
const statePath = path.join(outputRoot, "state.json");
const summaryPath = path.join(outputRoot, "latest-summary.md");
const htmlPath = path.join(outputRoot, "latest-report.html");
const jsonPath = path.join(outputRoot, "latest-report.json");
const jsPath = path.join(outputRoot, "latest-report.js");
const configPath = path.join(__dirname, "config.json");

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

function createBrowser(config) {
  const chromeExecutable = resolveChromeExecutable();

  return chromium.launch({
    executablePath: chromeExecutable || undefined,
    headless: config.scanner.headless !== false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--disable-dev-shm-usage",
    ],
  });
}

function createContext(browser) {
  const sessionStatePath = path.join(__dirname, ".session-state.json");
  const hasSession = fs.existsSync(sessionStatePath);

  if (!hasSession) {
    console.warn(
      "No saved session found. StreetEasy will likely block this run with a bot challenge.\n" +
        "Run `node monitor/bootstrap-session.cjs` once to solve it manually and save a trusted session."
    );
  }

  return browser.newContext({
    locale: "en-US",
    storageState: hasSession ? sessionStatePath : undefined,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 1600 },
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

async function inspectSource(sourceConfig, context, state, config, runAt, counters) {
  const searchPage = await context.newPage();
  const freshEntries = [];

  try {
    await searchPage.goto(sourceConfig.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await searchPage.waitForTimeout(config.scanner.waitAfterLoadMs || 1200);

    const searchResults = await extractSearchListings(searchPage, sourceConfig);
    const limitedResults = searchResults.slice(0, config.scanner.maxListingsPerSource || 20);

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

      const listingPage = await context.newPage();
      try {
        const catalogEntry = await inspectListing(candidate, listingPage, config, runAt);
        catalogEntry.lastSourceName = sourceConfig.name;

        state.catalog[entryId] = catalogEntry;
        freshEntries.push(catalogEntry);
        counters.newListingsInspected += 1;
      } catch (error) {
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

  const browser = await createBrowser(config);
  const context = await createContext(browser);
  const counters = { newListingsInspected: 0 };
  const newListings = [];

  try {
    for (const source of activeSources) {
      const freshEntries = await inspectSource(source, context, state, config, runAt, counters);
      newListings.push(...freshEntries);
    }
  } finally {
    await context.close();
    await browser.close();
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
