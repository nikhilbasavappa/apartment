const { withTimeout } = require("./util.cjs");

const UNLOCKER_ENDPOINT = "https://api.brightdata.com/request";
const REQUEST_TIMEOUT_MS = 45000;

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

// Heartbeat logging: three hangs traced to this exact request in one day,
// the last one surviving 16+ minutes with zero log output despite the
// withTimeout fix below (which races correctly in isolation — unit tested).
// Since we can no longer explain that from ps/lsof alone, log the actual
// lifecycle so the next occurrence pinpoints which phase is really stuck:
// if START appears but nothing else ever does (not even TIMEOUT_FIRED,
// which comes from a plain setTimeout independent of fetch/abort), that
// points at the event loop itself not processing timers during the stall,
// not just a slow network response.
async function requestOnce(url) {
  const startedAt = Date.now();
  const elapsed = () => `${Date.now() - startedAt}ms`;
  console.log(`UNLOCKER_REQUEST_START: ${url}`);

  // controller.abort() is still wired up as a best-effort attempt to tear
  // down the underlying socket, but the actual guarantee that this function
  // returns within REQUEST_TIMEOUT_MS comes from withTimeout wrapping the
  // whole attempt below — two hangs in one day showed the abort signal
  // alone doesn't reliably cut off a stalled body read.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const attempt = (async () => {
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
        signal: controller.signal,
      });
      console.log(`UNLOCKER_HEADERS_RECEIVED: ${url} after ${elapsed()}, status ${response.status}`);
    } catch (error) {
      console.log(`UNLOCKER_FETCH_REJECTED: ${url} after ${elapsed()}: ${error.message}`);
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

    const text = await response.text();
    console.log(`UNLOCKER_BODY_READ_COMPLETE: ${url} after ${elapsed()}, ${text.length} bytes`);
    return text;
  })();

  try {
    return await withTimeout(
      attempt,
      REQUEST_TIMEOUT_MS,
      `Bright Data unlocker request timed out for ${url}: no response within ${REQUEST_TIMEOUT_MS}ms (body read stalled)`
    ).catch((error) => {
      if (/timed out/.test(error.message)) {
        console.log(`UNLOCKER_TIMEOUT_FIRED: ${url} after ${elapsed()}`);
      }
      error.retryable = error.retryable ?? true;
      throw error;
    });
  } finally {
    clearTimeout(abortTimer);
  }
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
