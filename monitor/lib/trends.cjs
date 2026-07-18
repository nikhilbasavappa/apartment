// Cross-sectional market stats computed fresh from the current catalog on
// every scan — no historical data needed for this part. The separate
// market-history.json log (written by scan.cjs) is what turns these
// snapshots into an actual trend over time; this module only answers "what
// does the market look like right now."

const NEIGHBORHOOD_TIER_LABEL = {
  uwsIdeal: "UWS 70s-80s",
  uwsAcceptable: "UWS, outside 70s-80s",
  brooklyn: "Brooklyn",
  other: "other area",
  unknown: "unrated area",
};

function median(values) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
}

// How many days after a unit is first listed does it become available —
// what actually answers "how far ahead do I need my documents ready."
// "now" is treated as zero lead time rather than trying to guess how many
// days it's actually been sitting available.
function leadTimeDays(availableDate, estimatedListingDate) {
  if (!availableDate || !estimatedListingDate) return null;
  if (availableDate === "now") return 0;
  const available = new Date(availableDate);
  const listed = new Date(estimatedListingDate);
  if (Number.isNaN(available.getTime()) || Number.isNaN(listed.getTime())) return null;
  const days = Math.round((available.getTime() - listed.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}

const AUTO_UNAVAILABLE_REASON_PATTERN = /no longer listed on streeteasy|in contract on streeteasy/i;

function computeMarketStats(qualifying, excludedListings) {
  const byTier = {};

  qualifying.forEach((entry) => {
    const tier = entry.neighborhoodTier || "unknown";
    (byTier[tier] ||= []).push(entry);
  });

  const tiers = Object.entries(byTier).map(([tier, entries]) => {
    const prices = entries.map((e) => e.listing.price).filter((v) => Number.isFinite(v));
    const pricePerSqft = entries
      .filter((e) => Number.isFinite(e.listing.price) && Number.isFinite(e.listing.sqft) && e.listing.sqft > 0)
      .map((e) => e.listing.price / e.listing.sqft);
    const daysOnMarket = entries.map((e) => e.listing.daysOnMarket).filter((v) => Number.isFinite(v));
    const leadTimes = entries
      .map((e) => leadTimeDays(e.listing.availableDate, e.listing.estimatedListingDate))
      .filter((v) => Number.isFinite(v));

    return {
      tier,
      label: NEIGHBORHOOD_TIER_LABEL[tier] || tier,
      count: entries.length,
      medianPrice: median(prices),
      medianPricePerSqft: median(pricePerSqft),
      medianDaysOnMarket: median(daysOnMarket),
      medianLeadTimeDays: median(leadTimes),
    };
  });

  tiers.sort((a, b) => b.count - a.count);

  // A small, biased sample (only listings this catalog happened to already
  // be tracking when they went into contract/got taken down), but still a
  // real signal for "how fast is this market actually moving."
  const goneListings = excludedListings.filter((entry) =>
    (entry.reasons || []).some((reason) => AUTO_UNAVAILABLE_REASON_PATTERN.test(reason))
  );
  const contractSpeedDays = median(goneListings.map((e) => e.listing.daysOnMarket).filter((v) => Number.isFinite(v)));

  return {
    tiers,
    contractSpeed: {
      sampleSize: goneListings.length,
      medianDaysOnMarket: contractSpeedDays,
    },
  };
}

module.exports = { computeMarketStats, leadTimeDays, median, NEIGHBORHOOD_TIER_LABEL };
