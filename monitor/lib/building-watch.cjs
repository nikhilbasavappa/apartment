// Checks a fixed list of specific buildings' own leasing sites directly,
// rather than relying on the general StreetEasy search to surface them —
// some buildings post availability on their own site before (or instead of)
// StreetEasy. Every property management company/platform renders its
// availability page differently, so unlike the StreetEasy pipeline there is
// no single shared parser: each building gets its own small extraction
// function, dispatched by the `parser` field in monitor/buildings.json.
//
// Kept deliberately separate from the main StreetEasy scan.cjs pipeline —
// a failure checking one (or all) of these buildings should never break the
// real scan. Every parser is defensive: on any unexpected structure it logs
// a warning and returns an empty array rather than throwing.

const { withTimeout } = require("./util.cjs");

const FETCH_TIMEOUT_MS = 20000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchText(url) {
  return withTimeout(
    (async () => {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response.text();
    })(),
    FETCH_TIMEOUT_MS,
    `Building-watch fetch timed out for ${url}`
  );
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

function parseCurrency(raw) {
  if (raw === undefined || raw === null) return null;
  const value = Number.parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : null;
}

// Extracts a `{...}` JSON blob embedded in a script tag starting right
// after `marker`, using balanced-brace/string-aware scanning rather than a
// regex — the blob can be hundreds of KB and contains its own `;` and `}`
// inside strings, which a non-greedy regex can't reliably stop at.
function extractBalancedJson(html, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, i + 1);
    }
  }
  return null;
}

// Splits HTML into per-unit chunks anchored at each occurrence of
// `startMarker`, capped at `maxLen` chars — simpler and more robust than one
// giant multi-field regex per parser; each chunk then gets small
// single-field regexes run against it independently.
function extractBlocks(html, startMarker, maxLen = 4000) {
  const blocks = [];
  let idx = html.indexOf(startMarker);
  while (idx !== -1) {
    blocks.push(html.slice(idx, idx + maxLen));
    idx = html.indexOf(startMarker, idx + startMarker.length);
  }
  return blocks;
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : null;
}

// --- JSON/static-HTML parsers (no browser needed) ---

async function elliotApi(building) {
  const origin = new URL(building.url).origin;
  const units = await fetchJson(`${origin}/api/src-units`);
  return units.map((u) => ({
    unitNumber: u.unitNumber || u.id,
    beds: u.beds,
    baths: u.baths,
    price: u.priceGross ?? u.priceNet ?? null,
    url: building.url,
  }));
}

async function avalonEmbeddedJson(building) {
  const html = await fetchText(building.url);
  const marker = "Fusion.globalContent=";
  const idx = html.indexOf(marker);
  if (idx === -1) {
    console.warn(`BUILDING_WATCH_PARSE_MISS: ${building.id} — Fusion.globalContent marker not found`);
    return [];
  }
  const blob = extractBalancedJson(html, idx + marker.length);
  if (!blob) return [];
  const data = JSON.parse(blob);
  const units = data.units || [];
  return units.map((u) => ({
    unitNumber: u.unitName,
    beds: u.bedroomNumber,
    baths: u.bathroomNumber,
    sqft: u.squareFeet || null,
    price: u.startingAtPricesUnfurnished?.prices?.price ?? null,
    availableDate: u.availableDateUnfurnished || null,
    url: u.url || building.url,
  }));
}

// RentCafe-platform "unit-body" cards (data-unit/data-price/data-area/
// data-available attributes plus schema.org bedroom/bathroom microdata) —
// seen on Willoughby BK, likely reused by other RentCafe-hosted sites.
async function willoughbyDataAttrs(building) {
  const html = await fetchText(building.url);
  const blocks = extractBlocks(html, 'class="unit-name"');
  const results = [];
  for (const block of blocks) {
    const unitNumber = firstMatch(block, /class="unit-name"[^>]*>\s*([^<]+?)\s*</);
    const beds = firstMatch(block, /numberOfBedrooms"\s+content="([^"]*)"/);
    const baths = firstMatch(block, /numberOfBathroomsTotal"\s+content="([^"]*)"/);
    const sqft = firstMatch(block, /itemprop="floorSize">\s*([\d,]+)/);
    const price = firstMatch(block, /data-price="\$?([\d,]+)"/);
    const available = firstMatch(block, /data-available="([^"]*)"/);
    if (!unitNumber || price === null) continue;
    results.push({
      unitNumber,
      beds: beds !== null ? Number(beds) : null,
      baths: baths !== null ? Number(baths) : null,
      sqft: sqft ? Number(sqft.replace(/,/g, "")) : null,
      price: parseCurrency(price),
      availableText: available,
      url: building.url,
    });
  }
  return results;
}

// MNS platform, paragraph-list layout (540 Waverly): each unit is a
// `<p>{address} UNIT: {unit}</p><p>{beds} BEDS, {baths} BATHS</p><p>${price}</p>`
// sequence inside a shared wrapper class.
async function mnsParagraph(building) {
  const html = await fetchText(building.url);
  const blocks = extractBlocks(html, 'class="avail_list_right av_txt"');
  const results = [];
  for (const block of blocks) {
    const unitNumber = firstMatch(block, /UNIT:\s*([A-Za-z0-9-]+)/i);
    const bedBath = block.match(/(STUDIO|\d+)\s*BEDS?,\s*(\d+)\s*BATHS?/i);
    const price = firstMatch(block, /<p>\s*\$([\d,]+)\s*<\/p>/);
    if (!unitNumber || !price) continue;
    results.push({
      unitNumber,
      beds: bedBath ? (/studio/i.test(bedBath[1]) ? 0 : Number(bedBath[1])) : null,
      baths: bedBath ? Number(bedBath[2]) : null,
      price: parseCurrency(price),
      url: building.url,
    });
  }
  return results;
}

// MNS platform, table layout (Society Brooklyn — a two-tower development,
// "at Degraw" / "at Sackett"): <tr class="all_beds tower_ID beds_N" price="P">
// with unit number and tower name in the first two <td>s.
async function mnsTable(building) {
  const html = await fetchText(building.url);
  const blocks = extractBlocks(html, 'class="all_beds tower_');
  const results = [];
  for (const block of blocks) {
    const beds = firstMatch(block, /beds_(\d+)"/);
    const price = firstMatch(block, /price="(\d+)"/);
    // cells[0] is always an empty checkbox <td></td> — unit number and
    // tower name are the next two.
    const cells = [...block.matchAll(/<td>\s*([^<]*?)\s*<\/td>/g)].map((m) => m[1]);
    const unitNumber = cells[1];
    const towerName = cells[2];
    const bathsMatch = (cells[3] || "").match(/\d+(?:\.\d+)?\s*\/\s*(\d+(?:\.\d+)?)/);
    if (!unitNumber || !price) continue;
    results.push({
      unitNumber: towerName ? `${unitNumber} (${towerName})` : unitNumber,
      beds: beds !== null ? Number(beds) : null,
      baths: bathsMatch ? Number(bathsMatch[1]) : null,
      price: parseCurrency(price),
      url: building.url,
    });
  }
  return results;
}

// WordPress floorplan grid (420 Carroll): each card's `data-category` gives
// bed count, an <h3> gives the floorplan code, and "Starting from $X" gives
// a price. NOTE: this page shows floorplan TYPES, not necessarily individual
// physical units — a floorplan code may represent several available units at
// once. Still a useful "something's available" signal, just less precise
// than a real unit number.
async function wpFloorplanGrid(building) {
  const html = await fetchText(building.url);
  const blocks = extractBlocks(html, 'class="the_floorplan ');
  const results = [];
  for (const block of blocks) {
    const beds = firstMatch(block, /data-category="(\d+)"/);
    const name = firstMatch(block, /class="h3">\s*([^<]+?)\s*</);
    const bedBathText = firstMatch(block, /class="bed_bath">([\s\S]*?)<\/div>/);
    const price = firstMatch(block, /Starting from \$([\d,]+)/);
    if (!name || !price) continue;
    results.push({
      unitNumber: name,
      beds: beds !== null ? Number(beds) : null,
      baths: bedBathText ? Number(firstMatch(bedBathText, /(\d+)\s*Bathroom/i)) || null : null,
      price: parseCurrency(price),
      isFloorplanOnly: true,
      url: building.url,
    });
  }
  return results;
}

// TablePress WordPress plugin, plain HTML table (363 Bond Street): columns
// are Model/Unit/Beds/Baths/Price/Availability.
async function table363Bond(building) {
  const html = await fetchText(building.url);
  // Anchored to "<tr class=\"row-" specifically — a bare 'class="row-'
  // marker also matches the wrapping <tbody class="row-striping ...">,
  // which produced a spurious extra block whose 4000-char window
  // overlapped the very next real row and duplicated its data. Starting
  // the search from <tbody> also skips the header row (<thead>'s row-1 uses
  // <th>, not <td> — its own 4000-char window has no <td> of its own and
  // bled into the first real row's cells instead, duplicating it too).
  const bodyStart = html.indexOf("<tbody");
  const blocks = extractBlocks(bodyStart === -1 ? html : html.slice(bodyStart), '<tr class="row-');
  const results = [];
  for (const block of blocks) {
    const cells = [...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim()
    );
    if (cells.length < 6) continue;
    const [, unitNumber, beds, baths, price, availability] = cells;
    if (!unitNumber || !price || !/^\$/.test(price)) continue;
    results.push({
      unitNumber,
      beds: /studio/i.test(beds) ? 0 : Number.parseInt(beds, 10) || null,
      baths: Number.parseFloat(baths) || null,
      price: parseCurrency(price),
      availableText: availability || null,
      url: building.url,
    });
  }
  return results;
}

// "items_accord" cards (Eight80 BK): first three `.label_value` spans are
// unit number, beds/baths, price, in that order.
async function eight80Spans(building) {
  const html = await fetchText(building.url);
  const blocks = extractBlocks(html, 'class="items_accord"');
  const results = [];
  for (const block of blocks) {
    // Price is wrapped in an extra nested <span> ("<span class="label_value">
    // <span>$3,903</span></span>"), so it never comes through as the third
    // plain label_value text match — pull it separately via a direct $
    // search instead of assuming a flat sequence of three values.
    const values = [...block.matchAll(/label_value">\s*([^<]+?)\s*</g)].map((m) => m[1].trim());
    const [unitNumber, bedBath] = values;
    const price = firstMatch(block, /\$([\d,]+)/);
    if (!unitNumber || !price) continue;
    // \d+(?:\.\d+)? (not plain \d+) — a half-bath shows as "1.5", and a bare
    // \d+ against "1.5 / 1" matches the ".5" fragment as if it were the
    // start of a second number, misreading "1.5 / 1" as beds=5 baths=1.
    const bedBathMatch = bedBath ? bedBath.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/) : null;
    results.push({
      unitNumber,
      beds: bedBathMatch ? Number(bedBathMatch[1]) : null,
      baths: bedBathMatch ? Number(bedBathMatch[2]) : null,
      price: parseCurrency(price),
      url: building.url,
    });
  }
  return results;
}

// TF Cornerstone's portfolio-wide JSON covers all of their NYC buildings in
// one shared endpoint, filtered here by PropertyCode — any other TFC
// building added later reuses this exact same fetch, just a different code.
async function tfcPortfolio(building) {
  const data = await fetchJson("https://cdn.tfc.com/tfc-com/initial-data.json");
  const units = (data.Units?.Data || []).filter((u) => u.PropertyCode === building.tfcPropertyCode && u.IsListed);
  return units.map((u) => ({
    unitNumber: u.Apartment,
    beds: u.NumBedrooms,
    baths: u.NumBathrooms,
    price: u.Price ?? u.GrossRent ?? null,
    amenities: u.UnitFeatureCodes || [],
    dateListed: u.DateListed || null,
    url: building.url,
  }));
}

// Corcoran's search results are Cloudflare-protected (a plain fetch gets a
// 403), but readable through the same Bright Data unlocker already used for
// StreetEasy. Parses the flattened text the same way scan.cjs does.
async function corcoranSearch(building) {
  const { fetchViaUnlocker } = require("./unlocker.cjs");
  const html = await fetchViaUnlocker(building.url);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  // Each result reads like: "470 Dean Street, 501, Brooklyn, NY 11217
  // Apartment Building 1 BD 1 BA 757 Sq. Ft. Courtesy of Corcoran $4,900" —
  // note the page always spells out "Street"/"Avenue" in full even when
  // building.address abbreviates it ("470 Dean St"), so anchor on just the
  // house number + first word of the street name (never abbreviated) rather
  // than requiring an exact match on the full, possibly-abbreviated string.
  // Tightly bounded between the street name and its comma — the page also
  // has a search-box placeholder reading "470 Dean Street 1 More Enter a
  // location, address, ZIP..." earlier on the page, and an unbounded [^,]*
  // here matched all the way through that unrelated text to its first
  // comma, misreading "address" itself as a unit number.
  const [houseNumber, streetWord] = building.address.split(",")[0].split(/\s+/);
  const pattern = new RegExp(
    `${houseNumber}\\s+${streetWord}\\s+(?:Street|St|Avenue|Ave|Place|Pl|Road|Rd)?,\\s*(\\S+),[^$]*?\\$([\\d,]+)`,
    "gi"
  );
  const results = [];
  let match;
  while ((match = pattern.exec(text))) {
    results.push({
      unitNumber: match[1].replace(/,$/, ""),
      price: parseCurrency(match[2]),
      url: building.url,
    });
  }
  return results;
}

// Sites currently showing zero available units (no real listing to verify a
// parser against yet) get a best-effort generic scan rather than a
// hand-built parser: look for any `$X,XXX`-shaped price in the rendered
// text. If the site is genuinely empty (as confirmed for all three of these
// at the time this was built), this correctly returns nothing — but it
// hasn't been validated against a real populated example, so treat a
// non-empty result from this parser as worth double-checking by hand.
async function emptyGeneric(building) {
  const html = await fetchText(building.url);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const prices = [...text.matchAll(/\$([\d]{1,2},\d{3})\b/g)];
  if (!prices.length) return [];
  console.warn(
    `BUILDING_WATCH_UNVERIFIED_HIT: ${building.id} — emptyGeneric found ${prices.length} price(s), ` +
      "this parser has never been validated against real data, check by hand"
  );
  return prices.map((m, i) => ({
    unitNumber: `unverified-${i + 1}`,
    price: parseCurrency(m[1]),
    url: building.url,
    needsManualVerification: true,
  }));
}

async function stub(building) {
  console.warn(`BUILDING_WATCH_STUB: ${building.id} — ${building.note || "not implemented yet"}`);
  return [];
}

// --- Playwright-rendered text parsers (client-side-hydrated pages) ---

async function renderText(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(5000);
    return await page.evaluate(() => document.body.innerText);
  } finally {
    await page.close();
  }
}

// Bushburg-managed grid (The Rocklyn): repeating blocks of
// [optional promo] unitNumber, bedLabel, bathLabel, [optional "Terrace"],
// $price, DETAILS, INQUIRE.
async function rocklynText(building, context) {
  const text = await renderText(context, building.url);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const results = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\$[\d,]+$/.test(lines[i])) continue;
    let j = i - 1;
    let terrace = false;
    if (lines[j] === "Terrace") {
      terrace = true;
      j -= 1;
    }
    const bathLine = lines[j];
    const bedLine = lines[j - 1];
    const unitLine = lines[j - 2];
    if (!/^\d+\s*Bath$/i.test(bathLine || "") || !/^(Studio|\d+\s*Bed)$/i.test(bedLine || "")) continue;
    results.push({
      unitNumber: unitLine,
      beds: /studio/i.test(bedLine) ? 0 : Number.parseInt(bedLine, 10),
      baths: Number.parseInt(bathLine, 10),
      hasTerrace: terrace,
      price: parseCurrency(lines[i]),
      url: building.url,
    });
  }
  return results;
}

// One Boerum Place: unitNumber, "{beds} Bedroom {baths} Bath", "Int. {sqft} sf",
// "Private Outdoor Space: {Yes|No}", "$price/MONTH".
async function oneBoerumText(building, context) {
  const text = await renderText(context, building.url);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const results = [];
  for (let i = 0; i < lines.length; i += 1) {
    const priceMatch = lines[i].match(/^\$([\d,]+)\/MONTH$/i);
    if (!priceMatch) continue;
    const outdoorLine = lines[i - 1] || "";
    const sqftLine = lines[i - 2] || "";
    const bedBathLine = lines[i - 3] || "";
    const unitLine = lines[i - 4] || "";
    const bedBathMatch = bedBathLine.match(/(Studio|\d+)\s*Bedroom\s*(\d+)\s*Bath/i);
    if (!bedBathMatch) continue;
    results.push({
      unitNumber: unitLine,
      beds: /studio/i.test(bedBathMatch[1]) ? 0 : Number(bedBathMatch[1]),
      baths: Number(bedBathMatch[2]),
      sqft: Number.parseInt((sqftLine.match(/Int\.\s*([\d,]+)/) || [])[1] || "", 10) || null,
      hasPrivateOutdoorSpace: /Private Outdoor Space:\s*Yes/i.test(outdoorLine),
      price: parseCurrency(priceMatch[1]),
      url: building.url,
    });
  }
  return results;
}

// Longview (Corcoran New Development): a flat table with no per-cell labels
// — unitCode, $price, beds, baths, outdoor(Yes/No/blank), then
// "SCHEDULE A TOUR" closes the row. Based on a single observed example
// (only one unit listed at build time) — the shape of a second row is
// inferred, not confirmed, and may need adjustment once one appears.
async function longviewText(building, context) {
  const text = await renderText(context, building.url);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const results = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\$[\d,]+$/.test(lines[i])) continue;
    const unitLine = lines[i - 1];
    if (!unitLine || !/^[A-Za-z0-9-]{2,6}$/.test(unitLine)) continue;
    const beds = lines[i + 1];
    const baths = lines[i + 2];
    if (!/^\d+$/.test(beds || "") || !/^\d+$/.test(baths || "")) continue;
    results.push({
      unitNumber: unitLine,
      beds: Number(beds),
      baths: Number(baths),
      price: parseCurrency(lines[i]),
      url: building.url,
    });
  }
  return results;
}

const PARSERS = {
  elliotApi,
  avalonEmbeddedJson,
  willoughbyDataAttrs,
  mnsParagraph,
  mnsTable,
  wpFloorplanGrid,
  table363Bond,
  eight80Spans,
  tfcPortfolio,
  corcoranSearch,
  emptyGeneric,
  stub,
  // Playwright-dependent parsers take (building, context) instead of just (building).
  rocklynText,
  oneBoerumText,
  longviewText,
};

const NEEDS_BROWSER = new Set(["rocklynText", "oneBoerumText", "longviewText"]);

// `context` here is deliberately NOT the main scan's persistent StreetEasy
// context — that one runs with javaScriptEnabled:false (StreetEasy pages
// are loaded as static HTML via Bright Data; real navigation would tip off
// bot detection). These three buildings' own sites are ordinary
// client-rendered pages with no bot-wall observed, so they need a normal,
// separate, JS-enabled browser context instead. checkAllBuildings owns that
// context's lifecycle itself so callers never have to think about it.
async function checkBuilding(building, context) {
  const parser = PARSERS[building.parser];
  if (!parser) {
    return { error: `Unknown parser "${building.parser}"`, units: [] };
  }
  try {
    const units = NEEDS_BROWSER.has(building.parser) ? await parser(building, context) : await parser(building);
    return { error: null, units };
  } catch (error) {
    console.warn(`BUILDING_WATCH_FAILED: ${building.id} — ${error.message}`);
    return { error: error.message, units: [] };
  }
}

async function checkAllBuildings(buildings) {
  const results = {};
  const needsBrowser = buildings.some((b) => NEEDS_BROWSER.has(b.parser));
  let browser = null;
  let context = null;
  if (needsBrowser) {
    const { chromium } = require("playwright");
    browser = await chromium.launch();
    context = await browser.newContext();
  }
  try {
    for (const building of buildings) {
      results[building.id] = await checkBuilding(building, context);
    }
  } finally {
    if (browser) await browser.close();
  }
  return results;
}

// Merges freshly-checked results into state.buildingWatch, tracking
// firstSeenAt/lastSeenAt per unit the same way the main catalog does for
// listings — a unit missing from this run's results simply isn't carried
// forward (no retention window like the main catalog's 21 days; these are
// cheap to re-check every run, so there's no value in remembering a unit
// that's already gone). Mutates `state` in place, same convention as the
// rest of scan.cjs.
function mergeBuildingWatchState(state, buildings, results, runAt) {
  if (!state.buildingWatch) state.buildingWatch = {};

  for (const building of buildings) {
    const result = results[building.id];
    const previous = state.buildingWatch[building.id]?.units || {};
    const units = {};

    for (const unit of result.units) {
      const key = String(unit.unitNumber);
      const existing = previous[key];
      units[key] = {
        ...unit,
        firstSeenAt: existing?.firstSeenAt || runAt,
        lastSeenAt: runAt,
      };
    }

    state.buildingWatch[building.id] = {
      name: building.name,
      address: building.address,
      url: building.url,
      lastCheckedAt: runAt,
      error: result.error,
      units,
    };
  }
}

// Report-safe serialization for buildReport/toClientReport — an array
// (not the state's id-keyed object) sorted by name, each unit flagged
// `isNew` when this run is the one that first saw it.
function serializeBuildingWatch(buildingWatchState, runAt) {
  return Object.entries(buildingWatchState || {})
    .map(([id, entry]) => ({
      id,
      name: entry.name,
      address: entry.address,
      url: entry.url,
      lastCheckedAt: entry.lastCheckedAt,
      error: entry.error,
      units: Object.values(entry.units || {})
        .map((unit) => ({ ...unit, isNew: unit.firstSeenAt === runAt }))
        .sort((a, b) => (b.price || 0) - (a.price || 0)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  checkAllBuildings,
  checkBuilding,
  mergeBuildingWatchState,
  serializeBuildingWatch,
  PARSERS,
};
