const { withTimeout } = require("./util.cjs");

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const DIRECTIONS_ENDPOINT = "https://maps.googleapis.com/maps/api/directions/json";

function apiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_MAPS_API_KEY is not set (add it to monitor/.env)");
  }
  return key;
}

// Without this, a request that hangs mid-flight (observed happening after
// a network blip while the scan is already running, not just at startup)
// hangs the whole scan forever — fetch() has no default timeout of its own,
// and this ran unguarded for weeks before a hang traced back to it.
const REQUEST_TIMEOUT_MS = 20000;

// AbortSignal on the fetch() call alone doesn't reliably guard a stalled
// body read once headers already arrived — traced two multi-hour scan
// hangs to exactly this pattern in the Bright Data fetch (see
// unlocker.cjs). withTimeout wraps the whole fetch+json() attempt in its
// own deadline instead of trusting the signal to cover the body phase too.
async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await withTimeout(
      fetch(url, { signal: controller.signal }).then((response) => response.json()),
      REQUEST_TIMEOUT_MS,
      `Google Maps request timed out for ${url}: no response within ${REQUEST_TIMEOUT_MS}ms`
    );
  } finally {
    clearTimeout(abortTimer);
  }
}

async function geocodeAddress(address) {
  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey());

  const payload = await fetchJsonWithTimeout(url);

  if (payload.status !== "OK" || !payload.results?.length) {
    return null;
  }

  const result = payload.results[0];

  // Google's own geocode result already carries a neighborhood component
  // (reliably present for outer-borough addresses — "Long Island City",
  // "Park Slope", etc.) that was being fetched and discarded every time.
  // Falls back to the borough-level sublocality when Google itself doesn't
  // tag a specific neighborhood (common for Manhattan addresses) — coarser
  // than a real neighborhood name, but still better than nothing.
  const components = result.address_components || [];
  const neighborhoodComponent = components.find((c) => c.types.includes("neighborhood"));
  const boroughComponent = components.find((c) => c.types.includes("sublocality_level_1"));
  const geocodedNeighborhood = neighborhoodComponent?.long_name || boroughComponent?.long_name || null;

  return {
    formattedAddress: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    neighborhood: geocodedNeighborhood,
  };
}

function extractTransitLines(route) {
  const lines = new Set();

  route.legs?.forEach((leg) => {
    leg.steps?.forEach((step) => {
      if (step.travel_mode === "TRANSIT" && step.transit_details?.line) {
        const line = step.transit_details.line;
        lines.add(line.short_name || line.name);
      }
    });
  });

  return Array.from(lines).filter(Boolean);
}

async function getTransitDirections(origin, destinationAddress, arrivalTime) {
  const url = new URL(DIRECTIONS_ENDPOINT);
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", destinationAddress);
  url.searchParams.set("mode", "transit");
  if (arrivalTime) {
    url.searchParams.set("arrival_time", String(arrivalTime));
  }
  url.searchParams.set("key", apiKey());

  const payload = await fetchJsonWithTimeout(url);

  if (payload.status !== "OK" || !payload.routes?.length) {
    return null;
  }

  const route = payload.routes[0];
  const leg = route.legs[0];

  return {
    minutes: Math.round(leg.duration.value / 60),
    lines: extractTransitLines(route),
  };
}

function nextWeekdayMorning(hour = 9) {
  const date = new Date();
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 1));
  date.setHours(hour, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

async function computeCommutes(address, destinations) {
  const origin = await geocodeAddress(address);
  if (!origin) {
    return { origin: null, commutes: {}, error: "Could not geocode listing address" };
  }

  const arrivalTime = nextWeekdayMorning(9);
  const entries = Object.entries(destinations);
  const results = await Promise.all(
    entries.map(async ([key, destinationAddress]) => {
      try {
        const directions = await getTransitDirections(origin, destinationAddress, arrivalTime);
        return [key, directions];
      } catch (error) {
        return [key, null];
      }
    })
  );

  return {
    origin,
    commutes: Object.fromEntries(results),
  };
}

module.exports = {
  computeCommutes,
  geocodeAddress,
  getTransitDirections,
};
