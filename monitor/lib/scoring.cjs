const GOWANUS_PATTERN = /\bgowanus\b/i;
const UWS_PATTERN = /\bupper west side\b/i;
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

function isGowanus(neighborhood) {
  return GOWANUS_PATTERN.test(neighborhood || "");
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

const RANK_WEIGHTS = { neighborhood: 0.35, office: 0.35, friends: 0.3 };

// Blended ranking score used to sort qualifying listings — separate from the
// qualify/exclude hard filters above. Weighted 35% neighborhood preference,
// 35% office commute (the daily one), 30% average commute to the four
// friends' neighborhoods. Returns the components alongside the total so the
// UI can show why a listing ranked where it did, not just the number.
function rankBreakdown(commute, tier) {
  const neighborhoodScore = NEIGHBORHOOD_TIER_SCORE[tier] ?? NEIGHBORHOOD_TIER_SCORE.unknown;
  const officeScore = commuteScore(commute.office?.minutes);
  const friendScores = FRIEND_COMMUTE_KEYS.map((key) => commuteScore(commute[key]?.minutes));
  const avgFriendScore = friendScores.reduce((sum, score) => sum + score, 0) / friendScores.length;

  const total =
    RANK_WEIGHTS.neighborhood * neighborhoodScore +
    RANK_WEIGHTS.office * officeScore +
    RANK_WEIGHTS.friends * avgFriendScore;

  return {
    total,
    neighborhood: { score: neighborhoodScore, weight: RANK_WEIGHTS.neighborhood, tier },
    office: { score: officeScore, weight: RANK_WEIGHTS.office, minutes: commute.office?.minutes ?? null },
    friends: { score: avgFriendScore, weight: RANK_WEIGHTS.friends },
  };
}

function computeRankScore(commute, tier) {
  return rankBreakdown(commute, tier).total;
}

function extractNumber(text, regex) {
  const match = String(text || "").match(regex);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
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

function normalizeListing(rawListing) {
  const rawText = [rawListing.title, rawListing.description, rawListing.bodyText]
    .filter(Boolean)
    .join(" ");

  // Word-boundary anchored: without \b at the end, "ba"/"bed" match as
  // prefixes of ordinary words too — e.g. "$124 Base rent" was matching as
  // "124 ba[se]" and getting parsed as 124 bathrooms.
  const bedrooms =
    Number.isFinite(rawListing.bedrooms) && rawListing.bedrooms >= 0
      ? rawListing.bedrooms
      : extractNumber(rawText, /(\d+(?:\.\d+)?)\s*(?:bedrooms?|beds?|bd)\b/i) ??
        (/\bstudio\b/.test(rawText.toLowerCase()) ? 0 : null);
  const bathrooms =
    Number.isFinite(rawListing.bathrooms) && rawListing.bathrooms > 0
      ? rawListing.bathrooms
      : extractNumber(rawText, /(\d+(?:\.\d+)?)\s*(?:bathrooms?|baths?|ba)\b/i);
  // ft² (StreetEasy's usual format) was being missed entirely — the pattern
  // only covered "sf"/"sq ft"/"square feet", so real square footage sitting
  // right in the text (e.g. "586 ft²") was silently coming back as unknown.
  // Uses a lookahead instead of \b at the end: "²" is a non-word character,
  // so \b never matches between it and the space that follows — \b needs a
  // word/non-word transition, and both sides there are non-word.
  const sqft =
    Number.isFinite(rawListing.sqft) && rawListing.sqft > 0
      ? rawListing.sqft
      : extractNumber(rawText, /(\d{3,4})\s*(?:sf|sq\.?\s*ft|square feet|ft2|ft²)(?![a-zA-Z])/i);
  const price =
    Number.isFinite(rawListing.price) && rawListing.price > 0
      ? rawListing.price
      : extractNumber(rawText, /\$([\d,]{4,8})/);

  return {
    ...rawListing,
    availableDate: extractAvailableDate(rawText),
    bathrooms: bathrooms || null,
    bedrooms: Number.isFinite(bedrooms) ? bedrooms : null,
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
  const kitchenLayout =
    vision.kitchenVisible && vision.kitchenConfidence !== "low" ? vision.kitchenLayout : "unknown";
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

  if (isGowanus(listing.neighborhood)) {
    reasons.push("Neighborhood excluded: Gowanus");
  }

  const lat = commuteResult?.origin?.lat ?? listing.lat ?? null;
  const lng = commuteResult?.origin?.lng ?? listing.lng ?? null;

  if (isTooFarNorthOnUws(listing.neighborhood, listing.address, lat)) {
    reasons.push(`Upper West Side north of ${UWS_HARD_LIMIT}th St is outside the comfort zone`);
  }

  const qualifies = reasons.length === 0;

  const commute = commuteResult?.commutes || {};
  const tier = neighborhoodTier(listing.neighborhood, listing.borough, listing.address, lat);
  const breakdown = rankBreakdown(commute, tier);

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
  evaluateListing,
  isGowanus,
  neighborhoodTier,
  rankBreakdown,
};
