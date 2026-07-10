const UNLOCKER_ENDPOINT = "https://api.brightdata.com/request";

function apiKey() {
  const key = process.env.BRIGHTDATA_API_KEY;
  if (!key) {
    throw new Error("BRIGHTDATA_API_KEY is not set (add it to monitor/.env)");
  }
  return key;
}

function zoneName() {
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!zone) {
    throw new Error("BRIGHTDATA_ZONE is not set (add it to monitor/.env)");
  }
  return zone;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(url) {
  let response;
  try {
    response = await fetch(UNLOCKER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({
        zone: zoneName(),
        url,
        format: "raw",
      }),
      // Without this, an unlock request that hangs on Bright Data's end
      // (observed happening with some regularity) hangs the whole scan
      // forever — fetch() has no default timeout of its own.
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    const timeoutError = new Error(`Bright Data unlocker request timed out or failed for ${url}: ${error.message}`);
    timeoutError.retryable = true;
    throw timeoutError;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Bright Data unlocker request failed (${response.status}) for ${url}: ${body.slice(0, 300)}`);
    error.status = response.status;
    error.retryable = response.status >= 500 && response.status < 600;
    throw error;
  }

  return response.text();
}

// Fetches a URL through Bright Data's Web Unlocker: their infrastructure
// handles the proxy rotation, browser fingerprinting, and challenge-solving
// server-side and hands back the rendered page. We never connect to the
// target site directly for this request.
//
// Transient 502/503/504s and outright hangs from their own edge
// infrastructure show up with some regularity in practice — distinct from a
// genuinely blocked/failed unlock, which comes back as a 200 with challenge
// content, not an error status. Retry those a few times with backoff before
// giving up.
async function fetchViaUnlocker(url, { retries = 3 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestOnce(url);
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === retries) break;
      await sleep(500 * 2 ** attempt);
    }
  }

  throw lastError;
}

module.exports = {
  fetchViaUnlocker,
};
