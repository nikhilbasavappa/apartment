// Manhattan Valley: labeled distinctly from "Upper West Side" by StreetEasy,
// which meant it never hit the UWS-north-of-96th-St hard exclude even
// though it's geographically past it by definition (96th-110th St) — 475
// Central Park West #1C estimated to ~102nd St and slipped through purely
// because of the label mismatch.
// Murray Hill: explicit user rejection ("no chance I ever consider this...
// there should be nothing south of 60th"), not a borderline case.
const EXCLUDED_NEIGHBORHOOD_PATTERN = /\b(gowanus|crown heights|manhattan valley|murray hill)\b/i;
// StreetEasy labels the Lincoln Center-adjacent blocks "Lincoln Square"
// rather than "Upper West Side," even though it's the same area (its own
// listing copy describes the UWS architecture/style) — treat it as UWS.
const UWS_PATTERN = /\b(upper west side|lincoln square)\b/i;
const BROOKLYN_PATTERN = /\bbrooklyn\b/i;

// Preference tiers. UWS's apparent appeal turned out to be mostly proximity
// to a specific friend there, already captured by the friends-commute score
// component — so in a vacuum (commute held fixed) UWS and Brooklyn are
// actually a tie, not UWS-first. Everything else (LIC, other Manhattan
// neighborhoods like the Upper East Side, Queens generally) stays last. Not
// derived from commute itself — this is the standalone "where do I want to
// live, all else equal" layer.
// "uws" is further split by cross street below (uwsIdeal vs uwsAcceptable) —
// StreetEasy tags the whole stretch "Upper West Side" regardless of exactly
// where in it a listing sits, but the user's actual comfort zone is 72nd-96th,
// sweet spot 72nd-89th. That's a separate, real geographic preference
// (distinct from the friend-proximity point above), so it stays as its own
// tier rather than folding into a single flat UWS score.
const NEIGHBORHOOD_TIER_SCORE = { uwsIdeal: 100, uwsAcceptable: 80, brooklyn: 100, other: 30, unknown: 50 };

const UWS_IDEAL_MIN = 72;
const UWS_IDEAL_MAX = 89;
const UWS_HARD_LIMIT = 96;
// Calibrated by geocoding ten real "West Nth Street" UWS listings already in
// the catalog and fitting street number against latitude (see conversation
// history for the ten reference points) — not a guessed constant. Typical
// error is 1-3 streets, which is why the estimated-address hard-exclude
// below uses a wider margin than the directly-parsed case.
const UWS_LAT_TO_STREET_SLOPE = 1369.6702557556227;
const UWS_LAT_TO_STREET_INTERCEPT = -55779.309538443886;

function parseUwsStreetNumber(address) {
  const match = String(address || "").match(/\bWest\s+(\d{1,3})(?:st|nd|rd|th)\s+Street\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function estimateUwsStreetNumber(address, lat) {
  const exact = parseUwsStreetNumber(address);
  if (exact !== null) return { street: exact, exact: true };
  if (Number.isFinite(lat)) {
    return { street: UWS_LAT_TO_STREET_SLOPE * lat + UWS_LAT_TO_STREET_INTERCEPT, exact: false };
  }
  return { street: null, exact: false };
}

function neighborhoodTier(neighborhood, borough, address, lat) {
  if (UWS_PATTERN.test(neighborhood || "")) {
    const { street } = estimateUwsStreetNumber(address, lat);
    if (street === null) return "uwsIdeal"; // can't place it precisely — don't penalize for missing data
    if (street >= UWS_IDEAL_MIN && street <= UWS_IDEAL_MAX) return "uwsIdeal";
    return "uwsAcceptable";
  }
  if (BROOKLYN_PATTERN.test(borough || "")) return "brooklyn";
  if (neighborhood) return "other";
  return "unknown";
}

function isExcludedNeighborhood(neighborhood) {
  return EXCLUDED_NEIGHBORHOOD_PATTERN.test(neighborhood || "");
}

// A directly-parsed street number ("West 97th Street") is exact — trust it
// right at the line. An estimate derived from latitude carries several
// streets of typical error, so it only excludes once it's unambiguously
// past the limit, to avoid wrongly dropping a genuinely-fine listing near
// the boundary because of estimation noise.
function isTooFarNorthOnUws(neighborhood, address, lat) {
  if (!UWS_PATTERN.test(neighborhood || "")) return false;
  const { street, exact } = estimateUwsStreetNumber(address, lat);
  if (street === null) return false;
  return exact ? street > UWS_HARD_LIMIT : street > UWS_HARD_LIMIT + 3;
}

// Minutes -> 0-100, roughly linear, floored at 0 past an hour. Just needs to
// be monotonic and comparable across destinations, not precise.
function commuteScore(minutes) {
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(0, 100 - minutes * 1.7);
}

const FRIEND_COMMUTE_KEYS = ["upperWestSide", "morningsideHeights", "longIslandCity", "prospectHeights"];

const RANK_WEIGHTS = { neighborhood: 0.3, office: 0.3, friends: 0.25, size: 0.15 };

// Median real sqft among qualifying listings, by bedroom count (from the
// actual catalog once the sqft-extraction bug was fixed) — 671 for 1bd, 996
// for 2bd. Used to impute a neutral size score for the ~75% of listings that
// never have sqft in the source data at all, and to extrapolate 3bd+ (no
// real samples yet) via the same per-bedroom delta rather than guessing.
const SQFT_BASELINE_1BD = 671;
const SQFT_PER_EXTRA_BEDROOM = 325;

function estimateSqftForBedrooms(bedrooms) {
  const bd = Math.max(1, Number.isFinite(bedrooms) ? bedrooms : 1);
  return SQFT_BASELINE_1BD + SQFT_PER_EXTRA_BEDROOM * (bd - 1);
}

// A bigger apartment is always at least as good, but the same sqft feels
// much roomier split across fewer bedrooms — an 800sqft 1bd is spacious, an
// 800sqft 2bd is cramped. Dividing by sqrt(bedrooms) applies that penalty
// weakly (a straight linear divide would overcorrect) rather than not at
// all. Missing sqft gets the bedroom-typical estimate instead of a flat
// score, so an unknown-size studio doesn't score the same as an
// unknown-size 3-bedroom.
//
// Below 600 (per-bedroom-normalized), this goes negative instead of
// flooring at 0 — a listing genuinely too small (241 West 75th St #5, 500
// sqft/1bd, scored a merely-low 9/100 under the old 0-floored version and
// still ranked 61.8 overall on a great location) should actively drag the
// total down, not just fail to help it. Floors at -100 (reached at 200
// sqft/bedroom, a genuinely shoebox-sized space) so one degenerate listing
// can't blow up the weighted average.
function sqftScore(sqft, bedrooms) {
  const effectiveBedrooms = Math.max(1, Number.isFinite(bedrooms) ? bedrooms : 1);
  const actualOrEstimatedSqft = Number.isFinite(sqft) && sqft > 0 ? sqft : estimateSqftForBedrooms(effectiveBedrooms);
  const perBedroomSqft = actualOrEstimatedSqft / Math.sqrt(effectiveBedrooms);
  const SCORE_ZERO_POINT_SQFT = 600;
  const SCORE_CEILING_SQFT = 1000;
  const SCORE_FLOOR = -100;
  const raw = ((perBedroomSqft - SCORE_ZERO_POINT_SQFT) / (SCORE_CEILING_SQFT - SCORE_ZERO_POINT_SQFT)) * 100;
  return Math.max(SCORE_FLOOR, Math.min(100, raw));
}

// Blended ranking score used to sort qualifying listings — separate from the
// qualify/exclude hard filters above. Weighted 30% neighborhood preference,
// 30% office commute (the daily one), 25% average commute to the four
// friends' neighborhoods, 15% size (bedroom-normalized sqft). Returns the
// components alongside the total so the UI can show why a listing ranked
// where it did, not just the number.
function rankBreakdown(commute, tier, sqft, bedrooms) {
  const neighborhoodScore = NEIGHBORHOOD_TIER_SCORE[tier] ?? NEIGHBORHOOD_TIER_SCORE.unknown;
  const officeScore = commuteScore(commute.office?.minutes);
  const friendScores = FRIEND_COMMUTE_KEYS.map((key) => commuteScore(commute[key]?.minutes));
  const avgFriendScore = friendScores.reduce((sum, score) => sum + score, 0) / friendScores.length;
  const sizeScore = sqftScore(sqft, bedrooms);

  const total =
    RANK_WEIGHTS.neighborhood * neighborhoodScore +
    RANK_WEIGHTS.office * officeScore +
    RANK_WEIGHTS.friends * avgFriendScore +
    RANK_WEIGHTS.size * sizeScore;

  return {
    total,
    neighborhood: { score: neighborhoodScore, weight: RANK_WEIGHTS.neighborhood, tier },
    office: { score: officeScore, weight: RANK_WEIGHTS.office, minutes: commute.office?.minutes ?? null },
    friends: { score: avgFriendScore, weight: RANK_WEIGHTS.friends },
    size: { score: sizeScore, weight: RANK_WEIGHTS.size, sqft: sqft ?? null, bedrooms: bedrooms ?? null },
  };
}

function computeRankScore(commute, tier, sqft, bedrooms) {
  return rankBreakdown(commute, tier, sqft, bedrooms).total;
}

function extractNumber(text, regex) {
  const match = String(text || "").match(regex);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

// bodyText holds StreetEasy's own structured facts line ("950 ft² $78 per
// ft² 6 rooms..."); description is free-text marketing copy that sometimes
// throws in an imprecise "approximately 1000 sq ft" aside. Searching the
// title+description+bodyText blob with a plain first-match regex means
// whichever one happens to come first in that concatenation wins — and
// description comes before bodyText, so the rounded marketing figure was
// silently beating the real structured one. Try bodyText alone first.
function extractNumberPreferBody(bodyText, rawText, regex) {
  return extractNumber(bodyText, regex) ?? extractNumber(rawText, regex);
}

// StreetEasy listing pages show "Available now" or "Available M/D/YYYY" in
// body text — reliably present, no extra fetch needed.
function extractAvailableDate(text) {
  const match = String(text || "").match(/\bAvailable\s+(?:Available\s+)?(now|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i);
  if (!match) return null;
  if (/^now$/i.test(match[1])) return "now";

  const [month, day, yearRaw] = match[1].split("/").map(Number);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

// StreetEasy shows "Days on market N days" on most listing pages — how
// long it's been up as of this fetch. Combined with availableDate, this is
// what actually answers "how far ahead of move-in do units get listed":
// estimatedListingDate below backs out the original listing date from
// today's daysOnMarket snapshot, since daysOnMarket itself grows on every
// re-check and isn't stable to store directly.
function extractDaysOnMarket(text) {
  const match = String(text || "").match(/Days on market\s+(\d+)\s+days?/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function estimateListingDate(daysOnMarket) {
  if (!Number.isFinite(daysOnMarket)) return null;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysOnMarket);
  return date.toISOString().slice(0, 10);
}

// Vision classified this "open" from photos on real listings whose own
// marketing text says "Separate Chef's Kitchen" or "the closed kitchen
// style creates a separated environment" — a photo can look open-ish even
// when the actual room is a separate one, especially with the door held
// open for the shoot. The listing's own words about its own layout are a
// stronger signal than a photo inference, so this overrides vision rather
// than just supplementing it. [\w\s] alone doesn't span an apostrophe, so
// "Chef's Kitchen" broke the match entirely until '  was added here.
// Negation ("kitchen is NOT separate") is checked against the matched span
// itself, not text before it — the match already spans "kitchen ... not ...
// separate", so that's where a "not"/"n't" would actually show up.
function hasSeparateKitchenText(bodyText) {
  const pattern = /\b(?:separate|closed)\b[\w\s']{0,25}\bkitchen\b|\bkitchen\b[\w\s']{0,25}\b(?:separate|closed)\b/gi;
  const text = String(bodyText || "");
  let match;
  while ((match = pattern.exec(text))) {
    if (!/\bnot\b|n't\b/i.test(match[0])) return true;
  }
  return false;
}

function normalizeListing(rawListing) {
  const rawText = [rawListing.title, rawListing.description, rawListing.bodyText]
    .filter(Boolean)
    .join(" ");
  const bodyText = rawListing.bodyText || "";

  // Word-boundary anchored: without \b at the end, "ba"/"bed" match as
  // prefixes of ordinary words too — e.g. "$124 Base rent" was matching as
  // "124 ba[se]" and getting parsed as 124 bathrooms.
  const bedrooms =
    Number.isFinite(rawListing.bedrooms) && rawListing.bedrooms >= 0
      ? rawListing.bedrooms
      : extractNumberPreferBody(bodyText, rawText, /(\d+(?:\.\d+)?)\s*(?:bedrooms?|beds?|bd)\b/i) ??
        (/\bstudio\b/.test(rawText.toLowerCase()) ? 0 : null);
  const bathrooms =
    Number.isFinite(rawListing.bathrooms) && rawListing.bathrooms > 0
      ? rawListing.bathrooms
      : extractNumberPreferBody(bodyText, rawText, /(\d+(?:\.\d+)?)\s*(?:bathrooms?|baths?|ba)\b/i);
  // ft² (StreetEasy's usual format) was being missed entirely — the pattern
  // only covered "sf"/"sq ft"/"square feet", so real square footage sitting
  // right in the text (e.g. "586 ft²") was silently coming back as unknown.
  // Uses a lookahead instead of \b at the end: "²" is a non-word character,
  // so \b never matches between it and the space that follows — \b needs a
  // word/non-word transition, and both sides there are non-word.
  // Two failure modes fixed here:
  // 1. \d{3,4} alone doesn't span a thousands comma, so "1,176 ft²" matched
  //    just "176" — the digits after the comma — silently truncating
  //    anything over 999 sqft. Capturing the optional comma group fixes
  //    this; extractNumber already strips commas before parsing.
  // 2. Without requiring the "$X per ft²" that immediately follows
  //    StreetEasy's own per-unit facts line, this regex's first match could
  //    just as easily land on an unrelated number nearby in bodyText — a
  //    building amenity's square footage ("5,360 SF duplex fitness
  //    center"), a private patio's footprint ("600 SF of outdoor space"),
  //    or even an unrelated dollar figure from a sidebar article link. The
  //    "$/ft²" pairing only ever appears attached to the unit's own sqft,
  //    so requiring it is what actually disambiguates the real match.
  const sqft =
    Number.isFinite(rawListing.sqft) && rawListing.sqft > 0
      ? rawListing.sqft
      : extractNumberPreferBody(
          bodyText,
          rawText,
          /(\d{1,3}(?:,\d{3})*)\s*(?:sf|sq\.?\s*ft|square feet|ft2|ft²)(?![a-zA-Z])\s*\$[\d,]+\s*per\s*(?:sf|sq\.?\s*ft|ft2|ft²)/i
        );
  const price =
    Number.isFinite(rawListing.price) && rawListing.price > 0
      ? rawListing.price
      : extractNumberPreferBody(bodyText, rawText, /\$([\d,]{4,8})/);

  const daysOnMarket = extractDaysOnMarket(rawText);

  return {
    ...rawListing,
    availableDate: extractAvailableDate(rawText),
    bathrooms: bathrooms || null,
    bedrooms: Number.isFinite(bedrooms) ? bedrooms : null,
    daysOnMarket,
    estimatedListingDate: estimateListingDate(daysOnMarket),
    price: price || null,
    sqft: sqft || null,
  };
}

/**
 * A listing either clears every hard requirement or it is excluded outright —
 * no composite score, no partial credit.
 */
function evaluateListing(rawListing, visionResult, commuteResult, profile) {
  const listing = normalizeListing(rawListing);
  const reasons = [];

  // StreetEasy's own page doesn't always carry a neighborhood name (3 real
  // listings had none at all despite fully-resolved addresses) — Google's
  // geocode result for the same address almost always does, since it's
  // already being fetched for commute times anyway. Only used as a
  // fallback: StreetEasy's own label is more specific when it exists.
  if (!listing.neighborhood && commuteResult?.origin?.neighborhood) {
    listing.neighborhood = commuteResult.origin.neighborhood;
  }

  // Not re-verified from listing text: the search source already filters on
  // this amenity (amenities:washer_dryer), so it's trusted as-is.
  const washerDryer = "yes";

  const vision = visionResult || {
    kitchenVisible: false,
    kitchenLayout: "unknown",
    gasStove: "unknown",
    hasGarden: false,
    livingRoomSmall: false,
    notes: "",
  };

  // A low-confidence guess is worse than no answer: it looks the same as a
  // real "yes"/"closed" downstream but the model itself wasn't sure. Treat
  // it as unknown rather than trusting it as ground truth.
  const visionKitchenLayout =
    vision.kitchenVisible && vision.kitchenConfidence !== "low" ? vision.kitchenLayout : "unknown";
  // The listing's own description outranks a photo-based guess: a "separate
  // chef's kitchen" can still be framed to look open-ish in a single shot.
  const kitchenLayout = hasSeparateKitchenText(listing.bodyText) ? "closed" : visionKitchenLayout;
  const gasStove = vision.kitchenVisible && vision.stoveConfidence !== "low" ? vision.gasStove : "unknown";
  // "Private garden" specifically (not a shared courtyard) is an easy claim
  // to get subtly wrong from a photo alone — require high confidence, not
  // just "not low", before showing it as a fact.
  const hasGarden = vision.gardenConfidence === "high" ? Boolean(vision.hasGarden) : false;
  const livingRoomSmall = vision.livingRoomConfidence !== "low" ? Boolean(vision.livingRoomSmall) : false;

  if (listing.price === null) {
    reasons.push("Rent could not be confirmed");
  } else if (listing.price < profile.budgetMin || listing.price > profile.budgetMax) {
    reasons.push(`Rent $${listing.price} outside $${profile.budgetMin}-${profile.budgetMax}`);
  }

  if (listing.bedrooms === null) {
    reasons.push("Bedroom count could not be confirmed");
  } else if (listing.bedrooms < profile.bedroomsMin) {
    reasons.push(`${listing.bedrooms} bedroom(s), below minimum ${profile.bedroomsMin}`);
  }

  if (kitchenLayout !== "open" && kitchenLayout !== "semi-open") {
    reasons.push(
      vision.kitchenVisible
        ? `Kitchen photo shows a ${kitchenLayout} layout`
        : "Kitchen layout could not be confirmed from photos"
    );
  }

  if (isExcludedNeighborhood(listing.neighborhood)) {
    reasons.push(`Neighborhood excluded: ${listing.neighborhood}`);
  }

  const lat = commuteResult?.origin?.lat ?? listing.lat ?? null;
  const lng = commuteResult?.origin?.lng ?? listing.lng ?? null;

  if (isTooFarNorthOnUws(listing.neighborhood, listing.address, lat)) {
    reasons.push(`Upper West Side north of ${UWS_HARD_LIMIT}th St is outside the comfort zone`);
  }

  const qualifies = reasons.length === 0;

  const commute = commuteResult?.commutes || {};
  const tier = neighborhoodTier(listing.neighborhood, listing.borough, listing.address, lat);
  const breakdown = rankBreakdown(commute, tier, listing.sqft, listing.bedrooms);

  // Not a hard filter — just a signal that a listing's availability date is
  // close enough to warrant deciding on it sooner rather than letting it
  // sit in the general feed.
  const needsEarlyAction =
    Boolean(listing.availableDate) &&
    listing.availableDate !== "now" &&
    profile.earlyActionDate &&
    listing.availableDate >= profile.earlyActionDate;

  return {
    commute,
    gasStove,
    hasGarden,
    kitchenLayout,
    listing: {
      ...listing,
      lat,
      lng,
      washerDryer,
    },
    livingRoomSmall,
    needsEarlyAction,
    neighborhoodTier: tier,
    qualifies,
    rankScore: breakdown.total,
    rankBreakdown: breakdown,
    reasons,
    visionNotes: vision.notes || "",
  };
}

module.exports = {
  computeRankScore,
  estimateListingDate,
  evaluateListing,
  extractAvailableDate,
  extractDaysOnMarket,
  hasSeparateKitchenText,
  isExcludedNeighborhood,
  neighborhoodTier,
  rankBreakdown,
};
