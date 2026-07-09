#!/usr/bin/env node

const path = require("path");
const { chromium } = require("playwright");
const { extractListingDetail, extractSearchListings, resolveChromeExecutable } = require("./lib/adapters.cjs");
const { generateHtmlReport, generateMarkdownReport } = require("./lib/report.cjs");
const { sendNotifications } = require("./lib/notify.cjs");
const { scoreListing } = require("./lib/scoring.cjs");
const { defaultProfile } = require("./lib/shared-data.cjs");
const { ensureDir, formatTimestamp, readJson, writeJson, writeText } = require("./lib/util.cjs");

const workspaceRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(workspaceRoot, "monitor-output");
const screenshotDir = path.join(outputRoot, "screenshots");
const statePath = path.join(outputRoot, "state.json");
const summaryPath = path.join(outputRoot, "latest-summary.md");
const htmlPath = path.join(outputRoot, "latest-report.html");
const jsonPath = path.join(outputRoot, "latest-report.json");
const jsPath = path.join(outputRoot, "latest-report.js");
const configPath = path.join(__dirname, "config.json");

function loadConfig() {
  const config = readJson(configPath, null);
  if (!config) {
    throw new Error(`Missing config file at ${configPath}`);
  }

  return {
    ...config,
    profile: {
      ...defaultProfile,
      ...(config.profile || {}),
      weights: {
        ...defaultProfile.weights,
        ...(config.profile?.weights || {}),
      },
    },
  };
}

function loadState() {
  return readJson(statePath, {
    catalog: {},
    lastRunAt: null,
    version: 1,
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

function buildReport(state, runAt, config, newListings) {
  const topListings = Object.values(state.catalog)
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);

  return {
    htmlPath,
    jsonPath,
    newListings: newListings.sort((a, b) => b.score - a.score),
    runAt,
    sourcesConfigured: config.sources.filter((source) => source.enabled && source.url).length,
    summaryPath,
    topListings,
  };
}

function toClientReport(report) {
  const serializeEntry = (entry) => ({
    issues: entry.issues || [],
    label: entry.label,
    listing: {
      bathrooms: entry.listing.bathrooms,
      bedrooms: entry.listing.bedrooms,
      commuteMinutes: entry.listing.commuteMinutes,
      description: entry.listing.description,
      externalScreenshot: entry.listing.externalScreenshot,
      gasStove: entry.listing.gasStove,
      kitchenLayout: entry.listing.kitchenLayout,
      neighborhoodName: entry.listing.neighborhoodName,
      photos: entry.listing.photos || [],
      price: entry.listing.price,
      sqft: entry.listing.sqft,
      title: entry.listing.title,
      url: entry.listing.url,
      washerDryer: entry.listing.washerDryer,
    },
    pluses: entry.pluses || [],
    score: entry.score,
  });

  return {
    newListings: report.newListings.map(serializeEntry),
    runAt: report.runAt,
    sourcesConfigured: report.sourcesConfigured,
    topListings: report.topListings.map(serializeEntry),
  };
}

function saveReport(report) {
  ensureDir(outputRoot);
  writeJson(jsonPath, report);
  writeText(jsPath, `window.__LEX_MONITOR_REPORT__ = ${JSON.stringify(toClientReport(report), null, 2)};\n`);
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
  return browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 1600 },
  });
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
        const details = await extractListingDetail(listingPage, candidate, config, {
          rootDir: outputRoot,
          screenshotDir,
        });
        const scored = scoreListing(
          {
            ...candidate,
            ...details,
            sourceName: sourceConfig.name,
          },
          config.profile
        );

        const catalogEntry = {
          ...scored,
          firstSeenAt: runAt,
          lastSeenAt: runAt,
          lastSourceName: sourceConfig.name,
        };

        state.catalog[entryId] = catalogEntry;
        freshEntries.push(catalogEntry);
        counters.newListingsInspected += 1;
      } catch (error) {
        state.catalog[entryId] = {
          issues: [`Inspection failed: ${error.message}`],
          label: "Inspection Error",
          listing: {
            ...candidate,
            description: candidate.searchSnippet || "",
            externalScreenshot: null,
            neighborhoodName: "Unknown",
            photos: [],
            url: candidate.url,
          },
          pluses: [],
          score: 0,
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
        "# Lex & Laundry Monitor",
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

  console.log(
    `Scan complete at ${formatTimestamp(runAt)}. ${newListings.length} new listings inspected. Report: ${htmlPath}`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
