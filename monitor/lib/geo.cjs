const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const DIRECTIONS_ENDPOINT = "https://maps.googleapis.com/maps/api/directions/json";

function apiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_MAPS_API_KEY is not set (add it to monitor/.env)");
  }
  return key;
}

async function geocodeAddress(address) {
  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey());

  const response = await fetch(url);
  const payload = await response.json();

  if (payload.status !== "OK" || !payload.results?.length) {
    return null;
  }

  const result = payload.results[0];
  return {
    formattedAddress: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
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

  const response = await fetch(url);
  const payload = await response.json();

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
