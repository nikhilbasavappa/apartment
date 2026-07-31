#!/usr/bin/env node

const path = require("path");
const { chromium } = require("playwright");
const {
  BotChallengeError,
  ExtractionIncompleteError,
  buildPageUrl,
  clearStaleSingletonLock,
  extractListingDetail,
  extractSearchListings,
  loadViaUnlocker,
  resolveChromeExecutable,
} = require("./lib/adapters.cjs");
const { computeCommutes } = require("./lib/geo.cjs");
const { generateHtmlReport, generateMarkdownReport } = require("./lib/report.cjs");
const { sendNotifications } = require("./lib/notify.cjs");
const { estimateListingDate, evaluateListing, extractAvailableDate, extractDaysOnMarket } = require("./lib/scoring.cjs");
const { computeMarketStats } = require("./lib/trends.cjs");
const { classifyKitchenPhotos } = require("./lib/vision.cjs");
const fs = require("fs");
const { ensureDir, formatTimestamp, loadEnvFile, randomDelay, readJson, sleep, writeJson, writeText } = require("./lib/util.cjs");

const workspaceRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(workspaceRoot, "monitor-output");
const screenshotDir = path.join(outputRoot, "screenshots");
const statePath = path.join(outputRoot, "state.json");
const summaryPath = path.join(outputRoot, "latest-summary.md");
const htmlPath = path.join(outputRoot, "latest-report.html");
const jsonPath = path.join(outputRoot, "latest-report.json");
const marketHistoryPath = path.join(outputRoot, "market-history.json");
const jsPath = path.join(outputRoot, "latest-report.js");
const configPath = path.join(__dirname, "config.json");
const browserProfileDir = path.join(__dirname, ".browser-profile");

loadEnvFile(path.join(__dirname, ".env"));

const defaultProfile = {
  startDate: "2026-10-13",
  budgetMin: 4000,
  budgetMax: 7000,
  bedroomsMin: 1,
  earlyActionDate: "2026-09-01",
};

const defaultDestinations = {
  office: "Lexington Ave & E 53rd St, New York, NY",
  prospectHeights: "595 Dean Street, Brooklyn, NY 11238",
  longIslandCity: "4545 Center Boulevard, Long Island City, NY 11109",
  morningsideHeights: "Morningside Heights, New York, NY",
  upperWestSide: "Upper West Side, New York, NY",
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

function rankScore(entry) {
  return entry.rankScore ?? 0;
}

function buildReport(state, runAt, config, newListings) {
  const catalogEntries = Object.values(state.catalog);

  const qualifying = catalogEntries.filter((entry) => entry.qualifies);

  // Available-date is close enough that it likely needs a decision before
  // the general feed would normally surface it — highlighted in its own
  // section, but still part of the full qualifying set (topListings), not
  // removed from it, so "all qualifying listings" actually means all of them.
  const earlyActionListings = qualifying
    .filter((entry) => entry.needsEarlyAction)
    .sort((a, b) => (a.listing.availableDate || "").localeCompare(b.listing.availableDate || ""));

  const topListings = qualifying.slice().sort((a, b) => rankScore(b) - rankScore(a));

  const excludedListings = catalogEntries
    .filter((entry) => !entry.qualifies)
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  return {
    earlyActionListings,
    excludedListings,
    htmlPath,
    jsonPath,
    marketStats: computeMarketStats(qualifying, excludedListings),
    newListings: newListings.filter((entry) => entry.qualifies).sort((a, b) => rankScore(b) - rankScore(a)),
    runAt,
    sourcesConfigured: config.sources.filter((source) => source.enabled && source.url).length,
    summaryPath,
    topListings,
  };
}

function toClientReport(report) {
  const serializeEntry = (entry) => ({
    buildingType: entry.buildingType,
    commute: entry.commute,
    firstSeenAt: entry.firstSeenAt,
    hasGarden: entry.hasGarden,
    isCondo: entry.isCondo,
    isGroundFloor: entry.isGroundFloor,
    kitchenLayout: entry.kitchenLayout,
    kitchenSize: entry.kitchenSize,
    stoveType: entry.stoveType,
    listing: {
      address: entry.listing.address,
      availableDate: entry.listing.availableDate,
      bathrooms: entry.listing.bathrooms,
      bedrooms: entry.listing.bedrooms,
      daysOnMarket: entry.listing.daysOnMarket,
      description: entry.listing.description,
      estimatedListingDate: entry.listing.estimatedListingDate,
      externalScreenshot: entry.listing.externalScreenshot,
      neighborhood: entry.listing.neighborhood,
      photos: entry.listing.photos || [],
      price: entry.listing.price,
      sqft: entry.listing.sqft,
      title: entry.listing.title,
      url: entry.listing.url,
      washerDryer: entry.listing.washerDryer,
    },
    livingRoomSmall: entry.livingRoomSmall,
    needsEarlyAction: entry.needsEarlyAction,
    neighborhoodTier: entry.neighborhoodTier,
    rankBreakdown: entry.rankBreakdown,
    rankScore: entry.rankScore,
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
    earlyActionListings: report.earlyActionListings.map(serializeEntry),
    excludedListings: report.excludedListings.map(serializeExcluded),
    marketStats: report.marketStats,
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

// Cross-sectional market stats (in buildReport's marketStats) only need the
// current catalog and are recomputed fresh every run. This is the other
// half — a dated log of those same snapshots, tracked in git (unlike
// state.json) so it actually accumulates across scans instead of only ever
// reflecting "right now." Nothing reads this yet in a meaningful trend
// sense; it just needs to start existing so there's real history by the
// time enough of it has built up to be worth charting.
function appendMarketHistory(report) {
  const history = readJson(marketHistoryPath, []);
  history.push({ runAt: report.runAt, ...report.marketStats });
  writeJson(marketHistoryPath, history);
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
    // Pages are loaded via setContent() from Bright Data's response, not
    // real navigation — the document has no real origin, so the target
    // site's own script (React/Next.js) fails to hydrate against it and,
    // while recovering from that failure, tears out the very content we
    // came for. We only ever read static HTML/attributes, so none of that
    // execution is needed anyway.
    javaScriptEnabled: false,
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

// A real search-results page always has substantial nav/filter/footer text
// even when zero listings are shown; a degraded Bright Data response — seen
// in practice as status 200 with a genuinely empty body, which the unlocker
// layer doesn't treat as an error at all, so nothing throws or retries below
// it — collapses to almost nothing. Below this, treat the page as "failed to
// load," not "confirmed empty."
const SEARCH_PAGE_MIN_BODY_LENGTH = 500;
const SEARCH_PAGE_RETRIES = 2;

// StreetEasy paginates search results (?page=2, ?page=3, ...) rather than
// infinite-scrolling; a single page load only ever exposes a small slice
// (~11-20) of what can be several hundred total matches. Walk pages until
// one comes back genuinely empty, or the configured cap is hit.
async function collectSearchCandidates(searchPage, sourceConfig, config) {
  const collected = [];
  const seenUrls = new Set();
  const maxCandidates = config.scanner.maxListingsPerSource || 20;
  let consecutiveBadPages = 0;

  for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
    const pageUrl = buildPageUrl(sourceConfig.url, pageNumber);

    // A single degraded response used to be indistinguishable from "no more
    // results" and stopped pagination outright — on a search with 500+
    // matches (confirmed by a real run reaching page 19), that silently
    // truncated every page past whichever one happened to glitch, discarding
    // listings that were never actually exhausted. Retry the SAME page a
    // few times (both on a thrown error and on a suspiciously short body)
    // before treating it as a real signal.
    let pageResults = null;
    let sawBotChallenge = false;
    for (let attempt = 0; attempt <= SEARCH_PAGE_RETRIES; attempt += 1) {
      try {
        await loadViaUnlocker(searchPage, pageUrl, config.scanner.waitAfterLoadMs);
        await randomDelay(300, 700);
        const result = await extractSearchListings(searchPage, sourceConfig, pageUrl);
        if (result.bodyLength < SEARCH_PAGE_MIN_BODY_LENGTH) {
          throw new Error(`degraded response (${result.bodyLength} chars body)`);
        }
        pageResults = result.listings;
        break;
      } catch (error) {
        if (error instanceof BotChallengeError) {
          sawBotChallenge = true;
          console.warn(`SEARCH_BOT_CHALLENGE: ${error.message} (page ${pageNumber})`);
          break;
        }
        console.warn(
          `SEARCH_PAGE_RETRY: ${error.message} (page ${pageNumber}, attempt ${attempt + 1}/${SEARCH_PAGE_RETRIES + 1})`
        );
        if (attempt < SEARCH_PAGE_RETRIES) {
          await sleep(1000 * 2 ** attempt);
        }
      }
    }

    if (pageResults === null) {
      // Every attempt on this page failed (or hit a bot challenge). Three
      // consecutive bad pages is a much stronger "the source itself is
      // down/blocked" signal than one flaky page — stop the whole run
      // rather than grinding through up to 100 pages that'll all fail the
      // same way, but don't give up on the very first one the way the old
      // code did.
      consecutiveBadPages += 1;
      console.warn(`SEARCH_PAGE_FAILED: giving up on page ${pageNumber} after retries (${consecutiveBadPages} consecutive)`);
      if (sawBotChallenge || consecutiveBadPages >= 3) break;
      continue;
    }
    consecutiveBadPages = 0;

    const newOnes = pageResults.filter((item) => !seenUrls.has(item.url));

    if (!newOnes.length) break;

    newOnes.forEach((item) => {
      seenUrls.add(item.url);
      collected.push(item);
    });

    if (collected.length >= maxCandidates) break;

    // Bright Data handles StreetEasy-facing pacing now; this is just being
    // a reasonable citizen of the unlocker API itself, not evasion.
    await randomDelay(500, 1200);
  }

  return collected;
}

async function inspectSource(sourceConfig, context, state, config, runAt, counters) {
  const searchPage = await context.newPage();
  const freshEntries = [];
  let searchSucceeded = true;

  try {
    const searchResults = await collectSearchCandidates(searchPage, sourceConfig, config);
    if (!searchResults.length) {
      // Distinct, greppable signal: the search results page itself yielded
      // nothing, which usually means the bot wall blocked it before any
      // listing was ever reached — a stronger failure than a few individual
      // listings not parsing cleanly.
      console.warn(`ZERO_SEARCH_RESULTS: no listings found on search page for "${sourceConfig.name}"`);
      searchSucceeded = false;
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

      // This used to be paced to look human to StreetEasy directly; Bright
      // Data's infrastructure is what StreetEasy actually sees now, so this
      // is just light, well-behaved spacing on our calls to the unlocker
      // API itself, not evasion.
      if (counters.newListingsInspected > 0) {
        await randomDelay(400, 1000);
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
        } else if (error instanceof ExtractionIncompleteError) {
          // Same treatment as a bot challenge: this is a rendering race, not
          // a real rejection, so don't cache it — it'll just get picked up
          // again on the next run.
          console.warn(`EXTRACTION_INCOMPLETE: ${error.message}`);
        } else {
          state.catalog[entryId] = {
            commute: {},
            buildingType: null,
            isCondo: false,
            isGroundFloor: false,
            kitchenLayout: "unknown",
            kitchenSize: "unknown",
            stoveType: "unknown",
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

  return { freshEntries, searchSucceeded };
}

// A currently-active StreetEasy listing page always shows "$X for rent"
// within the first ~4,200 characters of body text, right after the address
// — verified against all 360 currently-qualifying listings with zero
// misses. A listing StreetEasy has taken down doesn't show this at all.
// Deliberately NOT matching on "No longer available" as a phrase — that
// text shows up in almost every listing's own price-history table for past
// (unrelated, sometimes years-old) rental cycles of the same unit, so a
// plain substring match would misfire on the majority of active listings.
const FOR_RENT_MARKER = /\$([\d,]+)\s+for rent\b/i;
const FOR_RENT_MARKER_WINDOW = 6000;

// StreetEasy renders a short status label + date immediately after the price
// disclaimer/"See cost breakdown" boilerplate whenever a unit isn't simply
// on the market — "In contract DATE", "Rented DATE", "Temporarily off market
// DATE", "No longer available DATE", "Delisted DATE" have all been observed
// on real listings, discovered one at a time (each one a listing the user
// caught still showing as qualifying) before it became clear this is a
// small enumerable set behind one StreetEasy UI component, not a fixed list
// worth whack-a-moling forever. Matching the *shape* — a capitalized label
// followed by a date, tightly anchored right after "for rent" — catches all
// of the above plus whatever StreetEasy phrases next without needing another
// investigation cycle each time.
//
// The one label that must NOT trigger exclusion is a bare "Available DATE"
// — that's the normal move-in-date field, not a status warning (e.g. "...
// Rental unit Downtown Brooklyn Available 7/23/2026" — a real match on a
// genuinely fine listing). Excluding exact label "Available" handles this;
// deliberately case-sensitive (no /i flag) so an all-lowercase run like
// "no longer available" still resolves to the real 3-word label "No longer
// available", not to a spurious bare "available" mid-phrase.
//
// Anchoring to the ~120 characters right after "for rent" (same window
// verified safe for the four predecessor patterns this replaces) keeps this
// from matching the unrelated "Available DATE"/status text that shows up
// further down in every listing's own price-history table and "Similar
// Homes" sidebar. Verified zero false positives against the 337 listings
// currently marked qualifying — the only two real matches were both
// genuine "Delisted" catches (38-38 32nd Street #907, 570 Fulton Street
// #16E) that had been slipping through undetected.
const STATUS_LABEL_PATTERN = /\$[\d,]+\s+for rent\b.{0,120}?\b([A-Z][a-z]*(?: [a-z]+){0,4}) \d{1,2}\/\d{1,2}\/\d{2,4}\b/s;

// Bumped whenever the detection logic itself gains a new capability — an
// entry last checked under an older version got a "still qualifies" result
// from a check that couldn't have caught what the newer version catches,
// so that clearance is stale even though the entry itself looks "recently
// revalidated." 160 Riverside Blvd #11A was rechecked the day after it
// actually went rented and still passed, because RENTED_PATTERN didn't
// exist yet when that check ran. Bump this number (not lastRevalidatedAt)
// any time detection logic changes, so previously-cleared entries
// automatically fall back to "needs a real check" without a manual
// one-off backlog sweep every time.
const REVALIDATION_LOGIC_VERSION = 5;

// The catalog only ever grows — nothing previously re-checks whether a
// qualifying listing is still actually live on StreetEasy. Re-verifying the
// entire catalog every run would mean hundreds of extra Bright Data fetches
// per scan, so this works through a bounded slice each run (oldest- or
// never-checked first), naturally cycling through the whole catalog over
// roughly a week at the default batch size instead of needing a separate
// maintenance script someone has to remember to run.
async function revalidateQualifyingListings(context, state, config, runAt) {
  const batchSize = config.scanner.revalidateBatchSize ?? 20;
  if (batchSize <= 0) return { checked: 0, removed: 0 };

  // An entry checked under an older detection-logic version is treated as
  // never-checked (priority 0) regardless of how recent its lastRevalidatedAt
  // is — its "still qualifies" result can't reflect a capability that didn't
  // exist yet when it ran.
  const priorityTime = (entry) => {
    if ((entry.lastRevalidatedLogicVersion ?? 0) < REVALIDATION_LOGIC_VERSION) return 0;
    return entry.lastRevalidatedAt ? new Date(entry.lastRevalidatedAt).getTime() : 0;
  };

  const candidates = Object.entries(state.catalog)
    .filter(([, entry]) => entry.qualifies && entry.listing?.url)
    .sort(([, a], [, b]) => priorityTime(a) - priorityTime(b))
    .slice(0, batchSize);

  let checked = 0;
  let removed = 0;

  for (const [entryId, entry] of candidates) {
    await randomDelay(400, 1000);
    const page = await context.newPage();
    try {
      const details = await extractListingDetail(
        page,
        { url: entry.listing.url, title: entry.listing.title, searchSnippet: "", cardImage: "" },
        config,
        { rootDir: outputRoot, screenshotDir }
      );

      const forRentMatch = FOR_RENT_MARKER.exec(details.bodyText.slice(0, FOR_RENT_MARKER_WINDOW));
      const stillListed = Boolean(forRentMatch);
      const statusMatch = STATUS_LABEL_PATTERN.exec(details.bodyText);
      const statusLabel = statusMatch && statusMatch[1] !== "Available" ? statusMatch[1] : null;
      entry.lastRevalidatedAt = runAt;
      entry.lastRevalidatedLogicVersion = REVALIDATION_LOGIC_VERSION;
      checked += 1;

      if (!stillListed) {
        entry.qualifies = false;
        entry.reasons = ["No longer listed on StreetEasy (auto-detected during periodic revalidation)"];
        removed += 1;
        console.log(`REVALIDATED_REMOVED: ${entry.listing.title}`);
      } else if (statusLabel) {
        entry.qualifies = false;
        entry.reasons = [`${statusLabel} on StreetEasy (auto-detected during periodic revalidation)`];
        removed += 1;
        console.log(`REVALIDATED_STATUS_${statusLabel.toUpperCase().replace(/\s+/g, "_")}: ${entry.listing.title}`);
      } else {
        // Price and availability date are the only listing fields that
        // legitimately drift over time (a landlord's decision, not a fixed
        // physical property like sqft/bedrooms) — refreshing those here
        // caught 110 4th Avenue #5E's availableDate having quietly slipped
        // from 9/15 to 10/15 since it was first scanned. Reusing the
        // for-rent marker's own capture group for price, rather than a
        // separate regex, means there's no second source of truth to drift
        // out of sync with the stillListed check itself.
        const refreshedPrice = Number.parseFloat(forRentMatch[1].replace(/,/g, ""));
        if (Number.isFinite(refreshedPrice) && refreshedPrice > 0 && refreshedPrice !== entry.listing.price) {
          console.log(`REVALIDATED_PRICE_CHANGED: ${entry.listing.title} — ${entry.listing.price} -> ${refreshedPrice}`);
          entry.listing.price = refreshedPrice;

          // A price refresh can push a previously-qualifying listing outside
          // the budget range — re-check the hard filter rather than letting
          // a rent hike silently sail through as still-qualifying.
          if (refreshedPrice < config.profile.budgetMin || refreshedPrice > config.profile.budgetMax) {
            entry.qualifies = false;
            entry.reasons = [
              `Rent $${refreshedPrice} outside $${config.profile.budgetMin}-${config.profile.budgetMax} (price changed since last check)`,
            ];
            removed += 1;
            console.log(`REVALIDATED_PRICE_OUT_OF_BUDGET: ${entry.listing.title}`);
          }
        }
        const refreshedAvailableDate = extractAvailableDate(details.bodyText);
        if (refreshedAvailableDate && refreshedAvailableDate !== entry.listing.availableDate) {
          console.log(
            `REVALIDATED_AVAILABLE_DATE_CHANGED: ${entry.listing.title} — ${entry.listing.availableDate} -> ${refreshedAvailableDate}`
          );
          entry.listing.availableDate = refreshedAvailableDate;
        }

        // daysOnMarket/estimatedListingDate are brand-new fields — none of
        // the catalog entries that predate this had them at all. Rather
        // than a separate one-off backfill fetching every listing again,
        // piggyback on the revalidation drip that's already fetching this
        // page anyway, so the market-stats trend data fills in gradually
        // as the existing twice-daily cycle works through the catalog.
        const refreshedDaysOnMarket = extractDaysOnMarket(details.bodyText);
        entry.listing.daysOnMarket = refreshedDaysOnMarket;
        entry.listing.estimatedListingDate = estimateListingDate(refreshedDaysOnMarket);
      }

      // Written after every listing, not just once at the end of the whole
      // batch — a batch of 150 can run for hours, and losing that much
      // progress to an interruption (or having nothing to inspect mid-run)
      // isn't worth the cost of a few extra small file writes.
      writeJson(statePath, state);
    } catch (error) {
      // Same caution as new-listing inspection: a bot challenge or a
      // rendering race isn't evidence the listing is gone, so leave
      // lastRevalidatedAt untouched — it stays at the front of the queue
      // for a retry next run instead of being pushed to the back on a
      // fetch failure that had nothing to do with availability.
      const label = error instanceof BotChallengeError || error instanceof ExtractionIncompleteError ? "transient" : "failed";
      console.warn(`REVALIDATE_${label.toUpperCase()}: ${entry.listing.title} — ${error.message} (will retry next run)`);
    } finally {
      await page.close();
    }
  }

  return { checked, removed };
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
  let anySourceSucceeded = false;

  let revalidation = { checked: 0, removed: 0 };
  try {
    for (const source of activeSources) {
      const { freshEntries, searchSucceeded } = await inspectSource(source, context, state, config, runAt, counters);
      newListings.push(...freshEntries);
      anySourceSucceeded = anySourceSucceeded || searchSucceeded;
    }

    // Skip on a day the search itself is already struggling (Bright Data
    // outage, bot wall) — piling on another batch of fetches that are
    // likely to fail the same way just burns quota for nothing.
    if (anySourceSucceeded) {
      revalidation = await revalidateQualifyingListings(context, state, config, runAt);
      if (revalidation.checked > 0) {
        console.log(`Revalidated ${revalidation.checked} existing listings, ${revalidation.removed} no longer available.`);
      }
    }
  } finally {
    await context.close();
  }

  // Only advance "last scan" on a run where at least one source's search
  // page actually returned something — a run that hit ZERO_SEARCH_RESULTS
  // everywhere didn't really scan anything, and letting it claim the
  // timestamp anyway is what produced the "Last Scan" display disagreeing
  // with what the published report actually reflects (the broken-run guard
  // in scheduled-scan.sh reverts monitor-output/, but state.json isn't
  // tracked, so lastRunAt would still silently jump ahead of the data).
  if (anySourceSucceeded) {
    state.lastRunAt = runAt;
  }
  writeJson(statePath, state);

  const report = buildReport(state, runAt, config, newListings);
  saveReport(report);
  // Same guard as lastRunAt above — a run that never really scanned
  // anything shouldn't add a data point to the trend log either.
  if (anySourceSucceeded) {
    appendMarketHistory(report);
  }
  sendNotifications(report, config);

  const qualifyingCount = newListings.filter((entry) => entry.qualifies).length;
  console.log(
    `Scan complete at ${formatTimestamp(runAt)}. ${newListings.length} new listings inspected, ${qualifyingCount} qualified, ` +
      `${revalidation.checked} revalidated (${revalidation.removed} no longer available). Report: ${htmlPath}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildReport,
  createPersistentContext,
  inspectListing,
  loadConfig,
  loadState,
  revalidateQualifyingListings,
  saveReport,
  statePath,
};
