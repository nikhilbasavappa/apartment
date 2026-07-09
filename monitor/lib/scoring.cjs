function detectFeatureSignals(text) {
  const haystack = String(text || "").toLowerCase();

  let washerDryer = "unknown";
  if (
    /\b(in[- ]unit|in unit|unit has|home has).{0,30}(washer|dryer)\b/.test(haystack) ||
    /\bwasher\/dryer in unit\b/.test(haystack) ||
    /\bfull[- ]size washer\/dryer\b/.test(haystack) ||
    /\bw\/d in unit\b/.test(haystack)
  ) {
    washerDryer = "yes";
  } else if (
    /\bno in[- ]unit (?:washer|laundry)\b/.test(haystack) ||
    /\bwasher\/dryer not (?:included|available)\b/.test(haystack) ||
    /\blaundry (?:is )?only in (?:the )?building\b/.test(haystack) ||
    /\bno washer\/dryer in unit\b/.test(haystack)
  ) {
    // Only an explicit negation overrides — a page mentioning a building-wide
    // "laundry room" amenity elsewhere does not mean this unit lacks in-unit W/D.
    washerDryer = "no";
  }

  return { washerDryer };
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

  const bedrooms =
    Number.isFinite(rawListing.bedrooms) && rawListing.bedrooms >= 0
      ? rawListing.bedrooms
      : extractNumber(rawText, /(\d+(?:\.\d+)?)\s*(?:bed|bd|bedroom)/i) ??
        (/\bstudio\b/.test(rawText.toLowerCase()) ? 0 : null);
  const bathrooms =
    Number.isFinite(rawListing.bathrooms) && rawListing.bathrooms > 0
      ? rawListing.bathrooms
      : extractNumber(rawText, /(\d+(?:\.\d+)?)\s*(?:bath|ba|bathroom)/i);
  const sqft =
    Number.isFinite(rawListing.sqft) && rawListing.sqft > 0
      ? rawListing.sqft
      : extractNumber(rawText, /(\d{3,4})\s*(?:sf|sq\.?\s*ft|square feet)/i);
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
  const textSignals = detectFeatureSignals([listing.title, listing.description, listing.bodyText].join(" "));
  const reasons = [];

  const washerDryer = textSignals.washerDryer === "no" ? "no" : "yes";
  if (textSignals.washerDryer === "no") {
    reasons.push("Listing text explicitly says no in-unit washer/dryer");
  }

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

  if (washerDryer !== "yes") {
    reasons.push("No confirmed in-unit washer/dryer");
  }

  if (kitchenLayout !== "open" && kitchenLayout !== "semi-open") {
    reasons.push(
      vision.kitchenVisible
        ? `Kitchen photo shows a ${kitchenLayout} layout`
        : "Kitchen layout could not be confirmed from photos"
    );
  }

  const qualifies = reasons.length === 0;

  const commute = commuteResult?.commutes || {};

  return {
    commute: {
      office: commute.office || null,
      prospectHeights: commute.prospectHeights || null,
      longIslandCity: commute.longIslandCity || null,
      morningsideHeights: commute.morningsideHeights || null,
    },
    gasStove,
    kitchenLayout,
    listing: {
      ...listing,
      washerDryer,
    },
    qualifies,
    reasons,
    visionNotes: vision.notes || "",
  };
}

module.exports = {
  detectFeatureSignals,
  evaluateListing,
};
