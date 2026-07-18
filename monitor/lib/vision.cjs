const MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_PHOTOS = 6;

const PROMPT = `You are looking at photos from a NYC apartment rental listing. Based only on what is visible in the photos, judge the following. If a photo is ambiguous, blurry, taken from an angle that hides the detail, or the relevant room/feature simply isn't shown, answer "unknown"/false rather than guessing — a wrong confident-sounding answer is worse than an honest "can't tell here".

Answer these questions:
1. Is a kitchen visible in any of these photos?
2. Is the kitchen open-plan (open or semi-open to a living/dining area) or enclosed in its own separate room (closed or a narrow galley layout)? A pass-through counter/opening to a hallway, foyer, or other non-living space does NOT count as open or semi-open — classify that as "closed". Only count it as open/semi-open if the kitchen shares real sightline and space with an actual living or dining area.
3. Is the stove/range gas or electric? Look for visible burners/grates (gas) versus a flat glass/ceramic cooktop or coil burners (electric/induction). This is genuinely hard to tell in many photos (reflections, angle, resolution) — if you're not confident, say so via stoveConfidence rather than picking one at random.
4. Does the unit have its own private outdoor space (a garden, yard, or terrace exclusively for this unit) — not a shared building courtyard, roof deck, or amenity space?
5. Does the living room look notably small/cramped based on the furniture-to-room ratio and how tight the framing is, versus a typical NYC one-bedroom living room?

Respond with ONLY strict JSON, no other text, in this exact shape:
{"kitchenVisible": true|false, "kitchenLayout": "open"|"semi-open"|"closed"|"galley"|"unknown", "kitchenConfidence": "high"|"medium"|"low", "gasStove": "yes"|"no"|"unknown", "stoveConfidence": "high"|"medium"|"low", "hasGarden": true|false, "gardenConfidence": "high"|"medium"|"low", "livingRoomSmall": true|false, "livingRoomConfidence": "high"|"medium"|"low", "notes": "one short sentence explaining what you saw"}

If no kitchen is visible in any photo, set kitchenVisible to false and kitchenLayout/gasStove to "unknown". If no living room or outdoor space is visible in any photo, set the corresponding field to false and its confidence to "low".`;

function apiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set (add it to monitor/.env)");
  }
  return key;
}

async function fetchImageAsBase64(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  // Tracking pixels/spacer gifs are typically well under 1KB; real listing photos never are.
  if (buffer.length < 2048 || buffer.length > 5 * 1024 * 1024) return null;

  return {
    mediaType: contentType.split(";")[0].trim(),
    data: buffer.toString("base64"),
  };
}

function extractJson(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (error) {
    return null;
  }
}

function unknownResult(notes) {
  return {
    kitchenVisible: false,
    kitchenLayout: "unknown",
    kitchenConfidence: "low",
    gasStove: "unknown",
    stoveConfidence: "low",
    hasGarden: false,
    gardenConfidence: "low",
    livingRoomSmall: false,
    livingRoomConfidence: "low",
    notes,
  };
}

async function classifyKitchenPhotos(photoUrls) {
  const urls = (photoUrls || []).slice(0, MAX_PHOTOS);

  if (!urls.length) {
    return unknownResult("No photos available to inspect.");
  }

  const images = (await Promise.all(urls.map(fetchImageAsBase64))).filter(Boolean);

  if (!images.length) {
    return unknownResult("Photos could not be downloaded for inspection.");
  }

  const content = [
    { type: "text", text: PROMPT },
    ...images.map((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    })),
  ];

  const response = await fetch(MESSAGES_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content }],
    }),
    // Without this, a request that hangs mid-flight (observed happening
    // after a network blip while the scan is already running) hangs the
    // whole scan forever — fetch() has no default timeout of its own. 45s
    // gives a multi-photo classification real room to run, unlike the 15s
    // used for the plain photo-fetch above.
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = await response.json();
  const text = payload.content?.find((block) => block.type === "text")?.text || "";
  const parsed = extractJson(text);

  if (!parsed) {
    return unknownResult("Model response could not be parsed.");
  }

  return parsed;
}

module.exports = {
  classifyKitchenPhotos,
};
