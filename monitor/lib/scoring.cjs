const GOWANUS_PATTERN = /\bgowanus\b/i;
const UWS_PATTERN = /\bupper west side\b/i;
const BROOKLYN_PATTERN = /\bbrooklyn\b/i;

// Preference tiers per the user's own ranking: Upper West Side first,
// Brooklyn second, everything else (LIC, other Manhattan neighborhoods like
// the Upper East Side, Queens generally) tied for last. Not derived from
// commute — this is a standalone "where do I want to live" preference.
const NEIGHBORHOOD_TIER_SCORE = { uws: 100, brooklyn: 65, other: 30, unknown: 50 };

function neighborhoodTier(neighborhood, borough) {
  if (UWS_PATTERN.test(neighborhood || "")) return "uws";
  if (BROOKLYN_PATTERN.test(borough || "")) return "brooklyn";
  if (neighborhood) return "other";
  return "unknown";
}

function isGowanus(neighborhood) {
  return GOWANUS_PATTERN.test(neighborhood || "");
}

// Minutes -> 0-100, roughly linear, floored at 0 past an hour. Just needs to
// be monotonic and comparable across destinations, not precise.
function commuteScore(minutes) {
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(0, 100 - minutes * 1.7);
}

const FRIEND_COMMUTE_KEYS = ["upperWestSide", "morningsideHeights", "longIslandCity", "prospectHeights"];

// Blended ranking score used to sort qualifying listings — separate from the
// qualify/exclude hard filters above. Weighted 35% neighborhood preference,
// 35% office commute (the daily one), 30% average commute to the four
// friends' neighborhoods.
function computeRankScore(commute, tier) {
  const neighborhoodScore = NEIGHBORHOOD_TIER_SCORE[tier] ?? NEIGHBORHOOD_TIER_SCORE.unknown;
  const officeScore = commuteScore(commute.office?.minutes);
  const friendScores = FRIEND_COMMUTE_KEYS.map((key) => commuteScore(commute[key]?.minutes));
  const avgFriendScore = friendScores.reduce((sum, score) => sum + score, 0) / friendScores.length;

  return 0.35 * neighborhoodScore + 0.35 * officeScore + 0.3 * avgFriendScore;
}

function extractNumber(text, regex) {
  const match = String(text || "").match(regex);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
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
  const sqft =
    Number.isFinite(rawListing.sqft) && rawListing.sqft > 0
      ? rawListing.sqft
      : extractNumber(rawText, /(\d{3,4})\s*(?:sf|sq\.?\s*ft|square feet)\b/i);
  const price =
    Number.isFinite(rawListing.price) && rawListing.price > 0
      ? rawListing.price
      : extractNumber(rawText, /\$([\d,]{4,8})/);

  return {
    ...rawListing,
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
    notes: "",
  };

  const kitchenLayout = vision.kitchenVisible ? vision.kitchenLayout : "unknown";
  const gasStove = vision.kitchenVisible ? vision.gasStove : "unknown";

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

  const qualifies = reasons.length === 0;

  const commute = commuteResult?.commutes || {};
  const tier = neighborhoodTier(listing.neighborhood, listing.borough);

  return {
    commute,
    gasStove,
    kitchenLayout,
    listing: {
      ...listing,
      washerDryer,
    },
    neighborhoodTier: tier,
    qualifies,
    rankScore: computeRankScore(commute, tier),
    reasons,
    visionNotes: vision.notes || "",
  };
}

module.exports = {
  computeRankScore,
  evaluateListing,
  isGowanus,
  neighborhoodTier,
};
