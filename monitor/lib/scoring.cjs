const { clamp } = require("./util.cjs");
const { defaultProfile, getNeighborhoodById, neighborhoods } = require("./shared-data.cjs");

function normalizeWeights(rawWeights) {
  const weights = { ...defaultProfile.weights, ...(rawWeights || {}) };
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, value / total])
  );
}

function commuteScoreFromMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 58;
  return clamp(100 - (minutes - 10) * 2.8, 32, 100);
}

function inferNeighborhoodId(text) {
  const haystack = String(text || "").toLowerCase();
  let best = null;

  neighborhoods.forEach((neighborhood) => {
    const matches = neighborhood.aliases.filter((alias) => haystack.includes(alias)).length;
    if (matches && (!best || matches > best.matches)) {
      best = { id: neighborhood.id, matches };
    }
  });

  return best ? best.id : null;
}

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
    /\blaundry in building\b/.test(haystack) ||
    /\bshared laundry\b/.test(haystack) ||
    /\blaundry room\b/.test(haystack) ||
    /\blaundry on floor\b/.test(haystack)
  ) {
    washerDryer = "no";
  }

  let kitchenLayout = "unknown";
  if (/\bgalley\b/.test(haystack)) {
    kitchenLayout = "galley";
  } else if (
    /\bopen kitchen\b/.test(haystack) ||
    /\bopen-concept kitchen\b/.test(haystack) ||
    /\bopen concept kitchen\b/.test(haystack) ||
    /\bkitchen island\b/.test(haystack) ||
    /\bisland kitchen\b/.test(haystack) ||
    /\bgreat room\b/.test(haystack) ||
    /\bopen living\/dining\b/.test(haystack)
  ) {
    kitchenLayout = "open";
  } else if (
    /\bsemi-open\b/.test(haystack) ||
    /\bpass-through kitchen\b/.test(haystack) ||
    /\bbreakfast bar\b/.test(haystack)
  ) {
    kitchenLayout = "semi-open";
  } else if (
    /\bwindowed kitchen\b/.test(haystack) ||
    /\bseparate kitchen\b/.test(haystack) ||
    /\bclosed kitchen\b/.test(haystack) ||
    /\beat-in kitchen\b/.test(haystack)
  ) {
    kitchenLayout = "closed";
  }

  let gasStove = "unknown";
  if (/\bgas stove\b/.test(haystack) || /\bgas range\b/.test(haystack) || /\bgas cooktop\b/.test(haystack)) {
    gasStove = "yes";
  } else if (/\belectric range\b/.test(haystack) || /\belectric stove\b/.test(haystack) || /\binduction\b/.test(haystack)) {
    gasStove = "no";
  }

  return { gasStove, kitchenLayout, washerDryer };
}

function extractNumber(text, regex) {
  const match = String(text || "").match(regex);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function normalizeListing(rawListing, profile) {
  const rawText = [rawListing.title, rawListing.description, rawListing.bodyText, rawListing.searchSnippet]
    .filter(Boolean)
    .join(" ");
  const signals = detectFeatureSignals(rawText);
  const neighborhoodId = rawListing.neighborhoodId || inferNeighborhoodId(rawText);
  const neighborhood = neighborhoodId ? getNeighborhoodById(neighborhoodId) : null;
  const bedrooms =
    Number.isFinite(rawListing.bedrooms) && rawListing.bedrooms > 0
      ? rawListing.bedrooms
      : extractNumber(rawText, /(\d+(?:\.\d+)?)\s*(?:bed|bd|bedroom)/i) ||
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
    bodyText: rawListing.bodyText || "",
    bathrooms: bathrooms || 0,
    bedrooms: Number.isFinite(bedrooms) ? bedrooms : null,
    commuteMinutes: rawListing.commuteMinutes || neighborhood?.commuteMinutes || null,
    gasStove: rawListing.gasStove || signals.gasStove,
    kitchenLayout: rawListing.kitchenLayout || signals.kitchenLayout,
    neighborhoodId,
    neighborhoodName: neighborhood?.name || rawListing.neighborhoodName || "Unknown",
    photos: Array.isArray(rawListing.photos) ? rawListing.photos : [],
    price: price || null,
    profile,
    sqft: sqft || 0,
    washerDryer: rawListing.washerDryer || signals.washerDryer,
  };
}

function scoreApartmentFit(listing, issues, pluses) {
  let total = 0;

  if (listing.washerDryer === "yes") {
    total += 38;
    pluses.push("in-unit washer/dryer");
  } else if (listing.washerDryer === "unknown") {
    total += 20;
    issues.push("Confirm in-unit washer/dryer");
  } else {
    issues.push("No in-unit washer/dryer");
  }

  switch (listing.kitchenLayout) {
    case "open":
      total += 40;
      pluses.push("open kitchen");
      break;
    case "semi-open":
      total += 28;
      pluses.push("semi-open kitchen");
      break;
    case "closed":
      total += 16;
      issues.push("Kitchen may feel boxed off");
      break;
    case "galley":
      issues.push("Galley kitchen");
      break;
    default:
      total += 16;
      issues.push("Kitchen layout still needs photo review");
      break;
  }

  if (listing.gasStove === "yes") {
    total += 12;
    pluses.push("gas stove");
  } else if (listing.gasStove === "unknown") {
    total += 6;
    issues.push("Confirm stove type");
  } else {
    total += 1;
  }

  if (listing.sqft >= 850) {
    total += 10;
    pluses.push("ample entertaining space");
  } else if (listing.sqft >= 700) {
    total += 6;
  } else if (listing.sqft > 0 && listing.sqft < 600) {
    issues.push("Could feel tight for hosting");
  }

  if (!listing.photos.length) {
    issues.push("No photos captured yet");
  }

  return clamp(total, 0, 100);
}

function scoreBudgetFit(listing, profile) {
  if (!Number.isFinite(listing.price)) return 45;
  if (listing.price <= profile.budgetTarget) {
    return clamp(100 - (profile.budgetTarget - listing.price) / 35, 84, 100);
  }
  if (listing.price <= profile.budgetStretch) {
    const overTarget = listing.price - profile.budgetTarget;
    const spread = Math.max(profile.budgetStretch - profile.budgetTarget, 1);
    return clamp(82 - (overTarget / spread) * 24, 55, 82);
  }
  return clamp(48 - (listing.price - profile.budgetStretch) / 20, 0, 48);
}

function scoreSpaceFit(listing, pluses) {
  let score = 0;

  if (listing.bedrooms >= 2) {
    score += 88;
    pluses.push("real office or guest room");
  } else if (listing.bedrooms >= 1) {
    score += 64;
  }

  if (listing.bathrooms >= 2) {
    score += 6;
  }

  if (listing.sqft >= 850) {
    score += 6;
  }

  return clamp(score, 0, 100);
}

function scoreListing(rawListing, rawProfile = {}) {
  const profile = {
    ...defaultProfile,
    ...rawProfile,
    weights: {
      ...defaultProfile.weights,
      ...(rawProfile.weights || {}),
    },
  };

  const listing = normalizeListing(rawListing, profile);
  const issues = [];
  const pluses = [];
  const neighborhood = listing.neighborhoodId ? getNeighborhoodById(listing.neighborhoodId) : null;
  const weights = normalizeWeights(profile.weights);

  const apartmentScore = scoreApartmentFit(listing, issues, pluses);
  const budgetScore = scoreBudgetFit(listing, profile);
  const spaceScore = scoreSpaceFit(listing, pluses);
  const commuteScore = commuteScoreFromMinutes(listing.commuteMinutes);
  const friendScore = neighborhood?.friends || 55;

  const score =
    apartmentScore * weights.apartment +
    commuteScore * weights.commute +
    friendScore * weights.friends +
    budgetScore * weights.budget +
    spaceScore * weights.space;

  const hardFail =
    (listing.bedrooms !== null && listing.bedrooms < 1) ||
    listing.washerDryer === "no" ||
    listing.kitchenLayout === "galley" ||
    (Number.isFinite(listing.price) && listing.price > profile.budgetStretch);

  const photoReviewNeeded =
    listing.kitchenLayout === "unknown" || listing.washerDryer === "unknown" || !listing.photos.length;

  if (Number.isFinite(listing.price) && listing.price > profile.budgetStretch) {
    issues.push("Above stretch budget");
  }
  if (listing.bedrooms === null) {
    issues.push("Bedrooms not confidently parsed");
  }
  if (!listing.neighborhoodId) {
    issues.push("Neighborhood not confidently parsed");
  }

  let label = "Watch";
  if (hardFail) {
    label = "Pass";
  } else if (score >= 84 && !photoReviewNeeded) {
    label = "High Attention";
  } else if (score >= 78 && photoReviewNeeded) {
    label = "Photo Check";
  } else if (score >= 74) {
    label = "Strong Candidate";
  } else if (score >= 64) {
    label = "Worth Touring";
  }

  return {
    apartmentScore,
    budgetScore,
    commuteScore,
    friendScore,
    hardFail,
    isShortlistReady: !hardFail && score >= 74,
    issues,
    label,
    listing,
    photoReviewNeeded,
    pluses,
    score,
    spaceScore,
  };
}

module.exports = {
  detectFeatureSignals,
  inferNeighborhoodId,
  scoreListing,
};
