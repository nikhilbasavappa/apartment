const fs = require("fs");
const path = require("path");
const { ensureDir, sanitizeFilename, sleep, slugify } = require("./util.cjs");

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

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "searchQueryState"].forEach((param) =>
      url.searchParams.delete(param)
    );
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

async function dismissOverlays(page) {
  const labels = [/accept/i, /agree/i, /got it/i, /close/i, /continue/i, /dismiss/i];

  for (const label of labels) {
    const locator = page.getByRole("button", { name: label }).first();
    try {
      if ((await locator.count()) > 0) {
        await locator.click({ timeout: 400 });
      }
    } catch (error) {
      // Ignore transient overlays.
    }
  }
}

async function autoScroll(page, steps = 3) {
  await page.evaluate(async (stepCount) => {
    for (let step = 0; step < stepCount; step += 1) {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    window.scrollTo(0, 0);
  }, steps);
}

async function extractSearchListings(page, sourceConfig) {
  const source = sourceConfig.source || detectSource(sourceConfig.url);
  await dismissOverlays(page);
  // More scroll depth than a single listing page: search results pages often
  // lazy-load additional cards as you scroll, so this is how more than the
  // first screenful gets into the DOM to scrape.
  await autoScroll(page, 10);

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
  /(teads\.tv|doubleclick|googlesyndication|google-analytics|googletagmanager|facebook\.com\/tr|maps\.googleapis\.com\/maps\/api\/staticmap|adsystem|\/track\?|\/pixel\?|\/beacon)/i;

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
  await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await dismissOverlays(page);
  await page.waitForTimeout(config.scanner.waitAfterLoadMs || 1200);
  await autoScroll(page);
  await sleep(350);

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
      url: location.href,
    };
  });

  const structuredObjects = parseStructuredData(raw.rawScripts);
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

  const listingId = createListingId(raw.url || candidate.url);
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
    description: structuredDescription || raw.metaDescription || candidate.searchSnippet || "",
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
    url: raw.url || candidate.url,
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
  createListingId,
  detectSource,
  extractListingDetail,
  extractSearchListings,
  normalizeUrl,
  resolveChromeExecutable,
};
