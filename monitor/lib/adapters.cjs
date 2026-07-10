const fs = require("fs");
const path = require("path");
const { ensureDir, sanitizeFilename, slugify } = require("./util.cjs");
const { fetchViaUnlocker } = require("./unlocker.cjs");

// Loads a page through Bright Data instead of navigating there directly, so
// the browser here is just a local renderer/parser for whatever HTML comes
// back — it never itself connects to the target site. setContent() doesn't
// know the page's real origin, so relative URLs (nav links, relative image
// src) would resolve against about:blank without an explicit <base> tag.
async function loadViaUnlocker(page, url, settleMs = 400) {
  const html = await fetchViaUnlocker(url);
  const origin = new URL(url).origin;
  const withBase = html.includes("<head>")
    ? html.replace("<head>", `<head><base href="${origin}/">`)
    : `<base href="${origin}/">${html}`;
  await page.setContent(withBase, { waitUntil: "domcontentloaded", timeout: 45000 });
  // domcontentloaded fires before layout/paint finish; document.body.innerText
  // (used for bodyText extraction) needs a completed layout pass or it comes
  // back empty/truncated, and how long that takes varies with page size. Poll
  // for real content instead of guessing a fixed delay; fall back to whatever
  // rendered once the budget runs out (a genuinely sparse page, not a bug).
  await page
    .waitForFunction(() => Boolean(document.body && document.body.innerText.trim().length > 200), {
      timeout: Math.max(settleMs, 3000),
    })
    .catch(() => {});
}

const SOURCE_PATTERNS = {
  streeteasy: [/streeteasy\.com\/rental\//i, /streeteasy\.com\/building\/[^/]+\/\d+/i],
  zillow: [/zillow\.com\/homedetails\//i, /zillow\.com\/b\//i],
  compass: [/compass\.com\/listing\//i],
  generic: [/\/rental\//i, /\/apartments?\//i, /\/listing\//i, /\/homedetails\//i, /\/property\//i],
};

function detectSource(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("streeteasy")) return "streeteasy";
  if (text.includes("zillow")) return "zillow";
  if (text.includes("compass")) return "compass";
  return "generic";
}

// Thrown instead of returning near-empty details when a listing page turns
// out to be a bot-detection challenge, not the real listing — distinct from
// a normal parse failure so callers can retry it later instead of
// permanently caching a meaningless "everything unknown" record.
class BotChallengeError extends Error {
  constructor(url) {
    super(`Bot challenge page encountered at ${url}`);
    this.name = "BotChallengeError";
  }
}

function isBotChallengePage(raw) {
  const title = (raw.pageTitle || "").toLowerCase();
  const body = (raw.bodyText || "").toLowerCase();
  return (
    title.includes("access to this page has been denied") ||
    body.includes("press & hold") ||
    (body.includes("confirm you are") && body.includes("not a bot"))
  );
}

// Same rationale as BotChallengeError: occasionally the layout/paint pass
// still hasn't finished by the time the settle-wait budget runs out (page
// size and Bright Data response time both vary run to run), leaving
// document.body.innerText empty even though real listing data, ld+json
// included, is present in the DOM. That's a rendering race, not a listing
// that's actually missing this data — don't cache a permanent "everything
// unknown" rejection for it, let it retry on the next run.
class ExtractionIncompleteError extends Error {
  constructor(url) {
    super(`Listing body text failed to render at ${url}`);
    this.name = "ExtractionIncompleteError";
  }
}

// StreetEasy search results are real pagination (?page=2, ?page=3, ...), not
// infinite scroll — a single page load only ever exposes ~11-20 of what can
// be several hundred total results.
function buildPageUrl(baseUrl, pageNumber) {
  const url = new URL(baseUrl);
  if (pageNumber <= 1) {
    url.searchParams.delete("page");
  } else {
    url.searchParams.set("page", String(pageNumber));
  }
  return url.toString();
}

// Chrome writes SingletonLock/Socket/Cookie on start and removes them on
// clean exit. If a prior run got killed, crashed, or the terminal closed
// before the process finished tearing down, the lock survives and blocks
// every future launch against this profile — including the unattended
// scheduled job — until someone notices and clears it by hand. Only remove
// it when the PID it names is confirmed gone, never just because it's old.
function clearStaleSingletonLock(profileDir) {
  const lockPath = path.join(profileDir, "SingletonLock");

  // SingletonLock is a dangling symlink by design (it points at a
  // "hostname-pid" string, not a real file), so fs.existsSync — which
  // follows symlinks and checks the target — always reports false for it.
  // lstatSync checks the link itself, not what it points to.
  try {
    if (!fs.lstatSync(lockPath).isSymbolicLink()) return;
  } catch (error) {
    return; // No lock file at all.
  }

  try {
    const target = fs.readlinkSync(lockPath);
    const pidMatch = target.match(/-(\d+)$/);
    const pid = pidMatch ? Number.parseInt(pidMatch[1], 10) : null;

    if (pid) {
      try {
        process.kill(pid, 0);
        return; // Signal delivery succeeded (or EPERM) — a process is there.
      } catch (error) {
        if (error.code !== "ESRCH") return; // Can't confirm it's dead — leave it alone.
      }
    }
  } catch (error) {
    return; // Not a symlink we can parse — don't guess, leave it alone.
  }

  ["SingletonLock", "SingletonSocket", "SingletonCookie"].forEach((name) => {
    try {
      fs.unlinkSync(path.join(profileDir, name));
    } catch (error) {
      // Already gone — fine.
    }
  });
  console.warn(`Cleared a stale browser profile lock at ${profileDir} (owning process no longer exists).`);
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    // Drop every query param, not just the utm_* ones: the same listing
    // shows up multiple times on a search page (a promoted "featured" slot
    // plus its normal ranked position) with different tracking/promo params
    // on otherwise-identical URLs — ?featured=1, ?infeed=1, ?lstt=... — and
    // each variant was getting cataloged as a separate listing. The path
    // alone is the real identity for a building/rental detail page.
    url.search = "";
    return url.toString();
  } catch (error) {
    return rawUrl;
  }
}

function createListingId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return slugify(`${url.hostname}${url.pathname}`);
  } catch (error) {
    return sanitizeFilename(rawUrl);
  }
}

function looksLikeListing(candidate, source) {
  const patterns = SOURCE_PATTERNS[source] || SOURCE_PATTERNS.generic;
  const text = [candidate.url, candidate.title, candidate.searchSnippet].join(" ");
  const hasPattern = patterns.some((pattern) => pattern.test(candidate.url));
  const hasHousingSignals =
    /\$[\d,]{4,8}/.test(text) || /\b(?:studio|\d(?:\.\d+)?\s*(?:bed|bd|bath|ba))\b/i.test(text);
  return hasPattern || hasHousingSignals;
}

async function extractSearchListings(page, sourceConfig) {
  const source = sourceConfig.source || detectSource(sourceConfig.url);
  // No dismissOverlays/scroll-to-lazy-load here: the page is static HTML
  // from the unlocker with JS disabled, so there's no interactive overlay
  // to click through and no client-side lazy-loading that scrolling could
  // trigger — everything server-rendered is already in the DOM. Real
  // pagination (buildPageUrl) is what surfaces more than a single page's
  // worth of results, not scrolling.

  const rawListings = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));

    return anchors
      .map((anchor) => {
        const card = anchor.closest("article, li, section, div");
        const cardText = card ? card.innerText.replace(/\s+/g, " ").trim() : "";
        const img = card ? card.querySelector("img") : null;
        return {
          cardImage: img ? img.src : "",
          searchSnippet: cardText.slice(0, 700),
          title:
            anchor.textContent.replace(/\s+/g, " ").trim() ||
            anchor.getAttribute("title") ||
            anchor.getAttribute("aria-label") ||
            "",
          url: anchor.href,
        };
      })
      .filter((item) => item.url.startsWith("http"));
  });

  const deduped = new Map();

  rawListings.forEach((listing) => {
    const normalized = normalizeUrl(listing.url);
    const candidate = {
      ...listing,
      source,
      url: normalized,
    };

    if (!looksLikeListing(candidate, source)) {
      return;
    }

    if (!deduped.has(normalized)) {
      deduped.set(normalized, candidate);
    }
  });

  return Array.from(deduped.values());
}

function flattenObjects(input, output = []) {
  if (Array.isArray(input)) {
    input.forEach((item) => flattenObjects(item, output));
    return output;
  }

  if (input && typeof input === "object") {
    output.push(input);
    Object.values(input).forEach((value) => flattenObjects(value, output));
  }

  return output;
}

function parseStructuredData(rawScripts) {
  const parsed = [];

  rawScripts.forEach((script) => {
    if (!script) return;
    try {
      const value = JSON.parse(script);
      flattenObjects(value, parsed);
    } catch (error) {
      // Ignore non-JSON scripts.
    }
  });

  return parsed;
}

function firstStructuredValue(objects, keys) {
  for (const object of objects) {
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null) {
        return object[key];
      }
    }
  }
  return null;
}

function formatStructuredAddress(address) {
  if (!address || typeof address !== "object") return null;
  const parts = [
    address.streetAddress,
    address.addressLocality || "New York",
    address.addressRegion || "NY",
    address.postalCode,
  ].filter(Boolean);
  if (!address.streetAddress) return null;
  return parts.join(", ");
}

// StreetEasy page titles follow "{address} in {Neighborhood}, {Borough} |
// StreetEasy" — the only reliable, consistently-tagged source of
// neighborhood name we have (listing descriptions mention it inconsistently
// depending on which fallback produced them).
const PAGE_TITLE_NEIGHBORHOOD_PATTERN = /\bin\s+([^,|]+),\s*([^|]+?)\s*\|/i;

function extractNeighborhood(pageTitle) {
  const match = String(pageTitle || "").match(PAGE_TITLE_NEIGHBORHOOD_PATTERN);
  if (!match) return { neighborhood: null, borough: null };
  return { neighborhood: match[1].trim(), borough: match[2].trim() };
}

const STREET_ADDRESS_PATTERN =
  /\d{1,5}\s+[A-Za-z0-9.'’\- ]{2,40}\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Pl|Place|Ln|Lane|Dr|Drive|Ct|Court|Way|Pkwy|Parkway|Ter|Terrace|Sq|Square)\b\.?(?:,?\s*(?:Apt|Unit|#)\s*[\w-]+)?/i;

function extractAddressFromText(text) {
  if (!text) return null;
  const match = String(text).match(STREET_ADDRESS_PATTERN);
  return match ? match[0].trim() : null;
}

function extractAddress(structuredObjects, raw) {
  const structuredAddress = structuredObjects
    .map((object) => formatStructuredAddress(object.address))
    .find(Boolean);
  if (structuredAddress) return structuredAddress;

  const fromTitle = extractAddressFromText(raw.pageTitle);
  if (fromTitle) return fromTitle;

  const fromH1 = extractAddressFromText(raw.h1);
  if (fromH1) return fromH1;

  return null;
}

const NON_PHOTO_URL_PATTERN =
  /(teads\.tv|doubleclick|googlesyndication|google-analytics|googletagmanager|facebook\.com\/tr|maps\.googleapis\.com\/maps\/api\/staticmap|adsystem|\/track\?|\/pixel\?|\/beacon|_logo_|\/logo\.)/i;

function looksLikePhoto(url) {
  if (NON_PHOTO_URL_PATTERN.test(url)) return false;
  return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) || /zillowstatic|streeteasy.*images|photos\./i.test(url);
}

function normalizePhotos(rawPhotos, limit) {
  const output = [];
  const seen = new Set();

  rawPhotos.forEach((photo) => {
    if (!photo) return;
    const value = typeof photo === "string" ? photo : photo.url || photo.contentUrl || photo.thumbnailUrl;
    if (!value || seen.has(value) || !/^https?:\/\//i.test(value)) return;
    if (!looksLikePhoto(value)) return;
    seen.add(value);
    output.push(value);
  });

  return output.slice(0, limit);
}

async function extractListingDetail(page, candidate, config, outputPaths) {
  await loadViaUnlocker(page, candidate.url, config.scanner.waitAfterLoadMs);
  // No dismissOverlays/autoScroll: static HTML with JS disabled, nothing
  // interactive to dismiss and no lazy-loading scrolling could trigger.

  const raw = await page.evaluate(() => {
    const metaDescription =
      document.querySelector('meta[name="description"]')?.getAttribute("content") ||
      document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
      "";
    const rawScripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"], script#__NEXT_DATA__')
    ).map((node) => node.textContent || "");

    const bodyText = document.body ? document.body.innerText.replace(/\s+/g, " ").trim() : "";
    const imageSources = Array.from(document.images)
      .map((image) => image.currentSrc || image.src || "")
      .filter(Boolean);

    return {
      bodyText: bodyText.slice(0, 60000),
      h1: document.querySelector("h1")?.innerText || "",
      imageSources,
      metaDescription,
      pageTitle: document.title || "",
      rawScripts,
    };
  });

  if (isBotChallengePage(raw)) {
    throw new BotChallengeError(candidate.url);
  }

  const structuredObjects = parseStructuredData(raw.rawScripts);

  // Real listing pages run several thousand characters of body text once
  // fully rendered. Short body text means either the rendering race the
  // settle-wait poll didn't fully catch, or Bright Data handed back a
  // degraded/partial response (seen in practice as occasional 502s and
  // timeouts) — in both cases the right move is a retry, not trusting the
  // near-empty result as ground truth. Originally this only fired when
  // ld+json was present but bodyText wasn't (implying a rendering race
  // specifically); broadened after finding a genuinely bad Bright Data
  // response can come back with empty ld+json too, which was silently
  // producing "everything unknown" records for listings that would extract
  // fine on retry.
  if (raw.bodyText.length < 1000) {
    throw new ExtractionIncompleteError(candidate.url);
  }

  const { neighborhood, borough } = extractNeighborhood(raw.pageTitle);
  const structuredName = firstStructuredValue(structuredObjects, ["name", "headline"]);
  const structuredDescription = firstStructuredValue(structuredObjects, ["description"]);
  const structuredPrice = firstStructuredValue(structuredObjects, ["price", "rent"]);
  const structuredBedrooms = firstStructuredValue(structuredObjects, ["numberOfBedrooms", "bedrooms"]);
  const structuredBathrooms = firstStructuredValue(structuredObjects, ["numberOfBathroomsTotal", "bathrooms"]);
  const structuredFloorSize = firstStructuredValue(structuredObjects, ["floorSize"]);
  const structuredImages = structuredObjects.flatMap((object) => {
    const images = object.image || object.images || object.photos;
    if (!images) return [];
    return Array.isArray(images) ? images : [images];
  });

  const listingId = createListingId(candidate.url);
  const screenshotFile = path.join(outputPaths.screenshotDir, `${listingId}.png`);

  if (config.scanner.captureScreenshots) {
    ensureDir(outputPaths.screenshotDir);
    await page.screenshot({ path: screenshotFile, fullPage: false });
  }

  return {
    address: extractAddress(structuredObjects, raw),
    bathrooms: Number.parseFloat(structuredBathrooms) || null,
    bedrooms: Number.parseFloat(structuredBedrooms) || null,
    bodyText: raw.bodyText,
    borough,
    description: structuredDescription || raw.metaDescription || candidate.searchSnippet || "",
    neighborhood,
    externalScreenshot: fs.existsSync(screenshotFile) ? path.relative(outputPaths.rootDir, screenshotFile) : null,
    id: listingId,
    photos: normalizePhotos(
      [candidate.cardImage, ...raw.imageSources, ...structuredImages],
      config.scanner.captureRemotePhotos || 6
    ),
    price: Number.parseFloat(String(structuredPrice || "").replace(/[^0-9.]/g, "")) || null,
    sqft:
      structuredFloorSize && typeof structuredFloorSize === "object"
        ? Number.parseFloat(structuredFloorSize.value)
        : Number.parseFloat(structuredFloorSize) || null,
    title: candidate.title || raw.h1 || structuredName || raw.pageTitle || candidate.url,
    url: candidate.url,
  };
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.APARTMENT_MONITOR_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

module.exports = {
  BotChallengeError,
  ExtractionIncompleteError,
  buildPageUrl,
  clearStaleSingletonLock,
  createListingId,
  detectSource,
  extractListingDetail,
  extractSearchListings,
  loadViaUnlocker,
  normalizeUrl,
  resolveChromeExecutable,
};
