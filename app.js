let latestMonitorReport = window.__APARTMENT_REPORT__ || null;
let monitorLoadState = location.protocol === "file:" ? "ready" : "loading";
registerServiceWorker();

const WEIGHTS_STORAGE_KEY = "apartmentScoreWeights";
const DEFAULT_WEIGHTS = { neighborhood: 23, office: 23, friends: 19, size: 14, livingRoom: 14, kitchenSize: 7 };
let currentWeights = loadWeights();

// Not persisted (unlike weights) — resets each visit, since this is more a
// "how do I want to look at things right now" setting than a stable
// preference. Shared across the New and All Qualifying tabs so switching
// tabs doesn't lose your sort/filter choice.
let currentSortFilter = { sort: "score", bedrooms: "any", gas: "any", availability: "available" };

const FEEDBACK_STORAGE_KEY = "apartmentFeedback";
let feedbackState = loadFeedback();

const els = {
  monitorLastRun: document.querySelector("#monitorLastRun"),
  globalLastScan: document.querySelector("#globalLastScan"),
  monitorSourceCount: document.querySelector("#monitorSourceCount"),
  monitorNewCount: document.querySelector("#monitorNewCount"),
  monitorBestCommute: document.querySelector("#monitorBestCommute"),
  monitorStatusCopy: document.querySelector("#monitorStatusCopy"),
  monitorFeedState: document.querySelector("#monitorFeedState"),
  monitorFeed: document.querySelector("#monitorFeed"),
  actNowPanel: document.querySelector("#actNowPanel"),
  actNowFeed: document.querySelector("#actNowFeed"),
  actNowCount: document.querySelector("#actNowCount"),
  actNowEmptyState: document.querySelector("#actNowEmptyState"),
  newFeed: document.querySelector("#newFeed"),
  newCount: document.querySelector("#newCount"),
  newEmptyState: document.querySelector("#newEmptyState"),
  monitorActions: document.querySelector("#monitorActions"),
  openFullReport: document.querySelector("#openFullReport"),
  openScanSummary: document.querySelector("#openScanSummary"),
  monitorTemplate: document.querySelector("#monitorTemplate"),
  excludedCount: document.querySelector("#excludedCount"),
  excludedList: document.querySelector("#excludedList"),
  excludedTemplate: document.querySelector("#excludedTemplate"),
  tabBar: document.querySelector("#tabBar"),
  tabCountActNow: document.querySelector("#tabCountActNow"),
  tabCountNew: document.querySelector("#tabCountNew"),
  tabCountAll: document.querySelector("#tabCountAll"),
  weightNeighborhood: document.querySelector("#weightNeighborhood"),
  weightOffice: document.querySelector("#weightOffice"),
  weightFriends: document.querySelector("#weightFriends"),
  weightSize: document.querySelector("#weightSize"),
  weightLivingRoom: document.querySelector("#weightLivingRoom"),
  weightKitchenSize: document.querySelector("#weightKitchenSize"),
  weightNeighborhoodValue: document.querySelector("#weightNeighborhoodValue"),
  weightOfficeValue: document.querySelector("#weightOfficeValue"),
  weightFriendsValue: document.querySelector("#weightFriendsValue"),
  weightSizeValue: document.querySelector("#weightSizeValue"),
  weightLivingRoomValue: document.querySelector("#weightLivingRoomValue"),
  weightKitchenSizeValue: document.querySelector("#weightKitchenSizeValue"),
  weightReset: document.querySelector("#weightReset"),
  tabCountStarred: document.querySelector("#tabCountStarred"),
  starredFeed: document.querySelector("#starredFeed"),
  starredExcludedList: document.querySelector("#starredExcludedList"),
  starredCount: document.querySelector("#starredCount"),
  starredEmptyState: document.querySelector("#starredEmptyState"),
  tabCountUnavailable: document.querySelector("#tabCountUnavailable"),
  unavailableFeed: document.querySelector("#unavailableFeed"),
  unavailableExcludedList: document.querySelector("#unavailableExcludedList"),
  unavailableCount: document.querySelector("#unavailableCount"),
  unavailableEmptyState: document.querySelector("#unavailableEmptyState"),
  marketTiers: document.querySelector("#marketTiers"),
  marketContractSpeed: document.querySelector("#marketContractSpeed"),
  marketTrendChart: document.querySelector("#marketTrendChart"),
  marketTrendEmptyState: document.querySelector("#marketTrendEmptyState"),
  exportFeedback: document.querySelector("#exportFeedback"),
};

init();

function init() {
  syncMonitorLinks();
  initTabs();
  initWeightSliders();
  initSortFilterControls();
  initExportFeedback();
  void loadMonitorReport();
}

// ---------- Stars & notes (localStorage only — this device, not synced) ----------

function loadFeedback() {
  try {
    const raw = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveFeedback() {
  try {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedbackState));
  } catch (error) {
    // localStorage unavailable (private browsing, etc.) — feedback just won't persist
  }
}

function getFeedback(url) {
  return feedbackState[url] || { starred: false, note: "", unavailable: false };
}

function setFeedback(url, title, patch) {
  const existing = getFeedback(url);
  const next = { ...existing, ...patch };
  if (!next.starred && !next.note && !next.unavailable) {
    delete feedbackState[url];
  } else {
    feedbackState[url] = { ...next, title, updatedAt: new Date().toISOString() };
  }
  saveFeedback();
}

function initExportFeedback() {
  els.exportFeedback?.addEventListener("click", () => {
    const entries = Object.entries(feedbackState).map(([url, data]) => ({ url, ...data }));
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `apartment-feedback-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

// ---------- Sort & filter (shared across New / All Qualifying tabs) ----------

function initSortFilterControls() {
  const sortSelects = document.querySelectorAll(".sort-select");
  const bedroomFilters = document.querySelectorAll(".bedroom-filter");
  const gasFilters = document.querySelectorAll(".gas-filter");
  const availabilityFilters = document.querySelectorAll(".availability-filter");

  sortSelects.forEach((select) => {
    select.value = currentSortFilter.sort;
    select.addEventListener("change", () => {
      currentSortFilter.sort = select.value;
      sortSelects.forEach((other) => (other.value = select.value));
      renderMonitor();
    });
  });

  bedroomFilters.forEach((select) => {
    select.value = currentSortFilter.bedrooms;
    select.addEventListener("change", () => {
      currentSortFilter.bedrooms = select.value;
      bedroomFilters.forEach((other) => (other.value = select.value));
      renderMonitor();
    });
  });

  gasFilters.forEach((select) => {
    select.value = currentSortFilter.gas;
    select.addEventListener("change", () => {
      currentSortFilter.gas = select.value;
      gasFilters.forEach((other) => (other.value = select.value));
      renderMonitor();
    });
  });

  availabilityFilters.forEach((select) => {
    select.value = currentSortFilter.availability;
    select.addEventListener("change", () => {
      currentSortFilter.availability = select.value;
      availabilityFilters.forEach((other) => (other.value = select.value));
      renderMonitor();
    });
  });
}

function applySortFilter(entries) {
  const filtered = entries.filter((entry) => {
    if (currentSortFilter.bedrooms !== "any") {
      const wanted = Number(currentSortFilter.bedrooms);
      const actual = entry.listing.bedrooms;
      if (actual === null) return false;
      if (wanted === 3 ? actual < 3 : actual !== wanted) return false;
    }
    if (currentSortFilter.gas !== "any" && entry.gasStove !== currentSortFilter.gas) return false;
    const unavailable = isUnavailable(entry);
    if (currentSortFilter.availability === "available" && unavailable) return false;
    if (currentSortFilter.availability === "unavailable" && !unavailable) return false;
    return true;
  });

  const sorters = {
    score: (a, b) => b.rankScore - a.rankScore,
    "price-asc": (a, b) => (a.listing.price ?? Infinity) - (b.listing.price ?? Infinity),
    "price-per-sqft-asc": (a, b) => pricePerSqft(a) - pricePerSqft(b),
    "sqft-desc": (a, b) => (b.listing.sqft ?? -Infinity) - (a.listing.sqft ?? -Infinity),
    "office-asc": (a, b) => (a.commute?.office?.minutes ?? Infinity) - (b.commute?.office?.minutes ?? Infinity),
  };

  return filtered.slice().sort(sorters[currentSortFilter.sort] || sorters.score);
}

function pricePerSqft(entry) {
  const price = entry.listing.price;
  const sqft = entry.listing.sqft;
  if (!price || !sqft) return Infinity;
  return price / sqft;
}

// ---------- Tabs ----------

function initTabs() {
  if (!els.tabBar) return;

  els.tabBar.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  window.addEventListener("hashchange", () => switchTab(currentTabFromHash()));
  switchTab(currentTabFromHash());
}

function currentTabFromHash() {
  const hash = location.hash.replace(/^#/, "");
  return ["criteria", "act-now", "new", "all", "starred", "unavailable", "market"].includes(hash) ? hash : "all";
}

function switchTab(tab) {
  document.querySelectorAll(".tab-page").forEach((page) => {
    page.hidden = page.dataset.tab !== tab;
  });
  els.tabBar?.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  if (location.hash.replace(/^#/, "") !== tab) {
    history.replaceState(null, "", `#${tab}`);
  }
}

// ---------- Score weights (client-side, adjustable) ----------

function loadWeights() {
  try {
    const raw = localStorage.getItem(WEIGHTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WEIGHTS };
    const parsed = JSON.parse(raw);
    if (
      Number.isFinite(parsed.neighborhood) &&
      Number.isFinite(parsed.office) &&
      Number.isFinite(parsed.friends) &&
      Number.isFinite(parsed.size) &&
      Number.isFinite(parsed.livingRoom) &&
      Number.isFinite(parsed.kitchenSize)
    ) {
      return parsed;
    }
  } catch (error) {
    // fall through to default
  }
  return { ...DEFAULT_WEIGHTS };
}

function saveWeights(weights) {
  try {
    localStorage.setItem(WEIGHTS_STORAGE_KEY, JSON.stringify(weights));
  } catch (error) {
    // localStorage unavailable (private browsing, etc.) — weights just won't persist
  }
}

// Adjusting one slider proportionally rescales the other two so all three
// keep summing to 100, preserving their relative ratio rather than just
// clamping (the standard "budget allocation" slider pattern).
function rebalanceWeights(changedKey, rawValues) {
  const values = { ...rawValues };
  const changedValue = Math.max(0, Math.min(100, values[changedKey]));
  values[changedKey] = changedValue;
  const remaining = 100 - changedValue;
  const otherKeys = Object.keys(values).filter((key) => key !== changedKey);
  const otherSum = otherKeys.reduce((sum, key) => sum + values[key], 0);

  if (otherSum <= 0) {
    otherKeys.forEach((key) => {
      values[key] = remaining / otherKeys.length;
    });
  } else {
    otherKeys.forEach((key) => {
      values[key] = (values[key] / otherSum) * remaining;
    });
  }

  return values;
}

function initWeightSliders() {
  if (
    !els.weightNeighborhood ||
    !els.weightOffice ||
    !els.weightFriends ||
    !els.weightSize ||
    !els.weightLivingRoom ||
    !els.weightKitchenSize
  )
    return;

  updateSliderUI();

  const sliderKeys = {
    [els.weightNeighborhood.id]: "neighborhood",
    [els.weightOffice.id]: "office",
    [els.weightFriends.id]: "friends",
    [els.weightSize.id]: "size",
    [els.weightLivingRoom.id]: "livingRoom",
    [els.weightKitchenSize.id]: "kitchenSize",
  };

  [
    els.weightNeighborhood,
    els.weightOffice,
    els.weightFriends,
    els.weightSize,
    els.weightLivingRoom,
    els.weightKitchenSize,
  ].forEach((slider) => {
    slider.addEventListener("input", () => {
      const key = sliderKeys[slider.id];
      currentWeights = rebalanceWeights(key, {
        neighborhood: Number(els.weightNeighborhood.value),
        office: Number(els.weightOffice.value),
        friends: Number(els.weightFriends.value),
        size: Number(els.weightSize.value),
        livingRoom: Number(els.weightLivingRoom.value),
        kitchenSize: Number(els.weightKitchenSize.value),
      });
      saveWeights(currentWeights);
      updateSliderUI();
      renderMonitor();
    });
  });

  els.weightReset?.addEventListener("click", () => {
    currentWeights = { ...DEFAULT_WEIGHTS };
    saveWeights(currentWeights);
    updateSliderUI();
    renderMonitor();
  });
}

function updateSliderUI() {
  els.weightNeighborhood.value = Math.round(currentWeights.neighborhood);
  els.weightOffice.value = Math.round(currentWeights.office);
  els.weightFriends.value = Math.round(currentWeights.friends);
  els.weightSize.value = Math.round(currentWeights.size);
  els.weightLivingRoom.value = Math.round(currentWeights.livingRoom);
  els.weightKitchenSize.value = Math.round(currentWeights.kitchenSize);
  els.weightNeighborhoodValue.textContent = `${Math.round(currentWeights.neighborhood)}%`;
  els.weightOfficeValue.textContent = `${Math.round(currentWeights.office)}%`;
  els.weightFriendsValue.textContent = `${Math.round(currentWeights.friends)}%`;
  els.weightLivingRoomValue.textContent = `${Math.round(currentWeights.livingRoom)}%`;
  els.weightSizeValue.textContent = `${Math.round(currentWeights.size)}%`;
  els.weightKitchenSizeValue.textContent = `${Math.round(currentWeights.kitchenSize)}%`;
}

// Mirrors monitor/lib/scoring.cjs's rankBreakdown so weight adjustments can
// re-sort and re-render without a server round-trip — the raw commute
// minutes and neighborhood tier are already in the client report data.
const NEIGHBORHOOD_TIER_SCORE = { uwsIdeal: 100, uwsAcceptable: 80, brooklyn: 100, other: 30, unknown: 50 };
const FRIEND_COMMUTE_KEYS = ["upperWestSide", "morningsideHeights", "longIslandCity", "prospectHeights"];

function commuteScore(minutes) {
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(0, 100 - minutes * 1.7);
}

// Same baseline/constants as monitor/lib/scoring.cjs's estimateSqftForBedrooms
// and sqftScore — median real sqft among qualifying listings, 671 for 1bd,
// 996 for 2bd, extrapolated linearly for 3bd+ (no real samples yet).
const SQFT_BASELINE_1BD = 671;
const SQFT_PER_EXTRA_BEDROOM = 325;
// Below 600 (per-bedroom-normalized) this goes negative instead of
// flooring at 0, so a genuinely too-small unit drags the total down rather
// than just failing to help it. Floors at -100, reached at 200 sqft/bedroom.
const SQFT_SCORE_ZERO_POINT = 600;
const SQFT_SCORE_CEILING = 1000;
const SQFT_SCORE_FLOOR = -100;

function estimateSqftForBedrooms(bedrooms) {
  const bd = Math.max(1, Number.isFinite(bedrooms) ? bedrooms : 1);
  return SQFT_BASELINE_1BD + SQFT_PER_EXTRA_BEDROOM * (bd - 1);
}

function sqftScore(sqft, bedrooms) {
  const effectiveBedrooms = Math.max(1, Number.isFinite(bedrooms) ? bedrooms : 1);
  const actualOrEstimatedSqft = Number.isFinite(sqft) && sqft > 0 ? sqft : estimateSqftForBedrooms(effectiveBedrooms);
  const perBedroomSqft = actualOrEstimatedSqft / Math.sqrt(effectiveBedrooms);
  const raw = ((perBedroomSqft - SQFT_SCORE_ZERO_POINT) / (SQFT_SCORE_CEILING - SQFT_SCORE_ZERO_POINT)) * 100;
  return Math.max(SQFT_SCORE_FLOOR, Math.min(100, raw));
}

function livingRoomScore(livingRoomSmall) {
  return livingRoomSmall ? 0 : 100;
}

function kitchenSizeScore(kitchenSize) {
  if (kitchenSize === "large") return 100;
  if (kitchenSize === "small") return 0;
  return 50;
}

function computeClientRankBreakdown(entry, weights) {
  const tier = entry.neighborhoodTier || "unknown";
  const neighborhoodScore = NEIGHBORHOOD_TIER_SCORE[tier] ?? NEIGHBORHOOD_TIER_SCORE.unknown;
  const officeScore = commuteScore(entry.commute?.office?.minutes);
  const friendScores = FRIEND_COMMUTE_KEYS.map((key) => commuteScore(entry.commute?.[key]?.minutes));
  const avgFriendScore = friendScores.reduce((sum, score) => sum + score, 0) / friendScores.length;
  const sizeScore = sqftScore(entry.listing?.sqft, entry.listing?.bedrooms);
  const livingRoomScoreValue = livingRoomScore(entry.livingRoomSmall);
  const kitchenSizeScoreValue = kitchenSizeScore(entry.kitchenSize);

  const nWeight = weights.neighborhood / 100;
  const oWeight = weights.office / 100;
  const fWeight = weights.friends / 100;
  const sWeight = weights.size / 100;
  const lWeight = weights.livingRoom / 100;
  const kWeight = weights.kitchenSize / 100;

  return {
    total:
      nWeight * neighborhoodScore +
      oWeight * officeScore +
      fWeight * avgFriendScore +
      sWeight * sizeScore +
      lWeight * livingRoomScoreValue +
      kWeight * kitchenSizeScoreValue,
    neighborhood: { score: neighborhoodScore, weight: nWeight, tier },
    office: { score: officeScore, weight: oWeight },
    friends: { score: avgFriendScore, weight: fWeight },
    size: { score: sizeScore, weight: sWeight },
    livingRoom: { score: livingRoomScoreValue, weight: lWeight, small: Boolean(entry.livingRoomSmall) },
    kitchenSize: { score: kitchenSizeScoreValue, weight: kWeight, size: entry.kitchenSize || "unknown" },
  };
}

function withClientScore(entry) {
  const breakdown = computeClientRankBreakdown(entry, currentWeights);
  return { ...entry, rankScore: breakdown.total, rankBreakdown: breakdown };
}

// ---------- Data loading ----------

async function loadMonitorReport() {
  if (location.protocol === "file:") {
    monitorLoadState = "ready";
    renderMonitor();
    return;
  }

  try {
    const remoteReport = await fetchLiveMonitorReport();
    if (remoteReport) {
      latestMonitorReport = remoteReport;
    }
    monitorLoadState = "ready";
  } catch (error) {
    console.warn("Live monitor report fetch failed", error);
    monitorLoadState = latestMonitorReport ? "ready" : "error";
  }

  renderMonitor();
}

async function fetchLiveMonitorReport() {
  // GitHub Pages is a static host — there's no "./api/report" backend route,
  // so this always 404'd and silently fell back to whatever the static
  // <script src="monitor-output/latest-report.js"> tag happened to load,
  // making freshness entirely dependent on the service worker behaving
  // perfectly. Fetch the real JSON data directly instead, with a cache-busting
  // query param so no caching layer (service worker, browser HTTP cache, or
  // GitHub Pages' own CDN) can serve a stale copy regardless of headers.
  const response = await fetch(`./monitor-output/latest-report.json?v=${Date.now()}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Report request failed with ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    return latestMonitorReport;
  }

  const report = payload.report && typeof payload.report === "object" ? payload.report : payload;
  if (!Array.isArray(report.topListings) || !Array.isArray(report.newListings)) {
    return latestMonitorReport;
  }

  return report;
}

// ---------- Rendering ----------

function renderMonitor() {
  if (!els.monitorFeed || !els.monitorFeedState) return;

  const report = latestMonitorReport;
  els.monitorFeed.innerHTML = "";

  if (!report) {
    els.monitorLastRun.textContent = "Waiting for first scan";
    if (els.globalLastScan) els.globalLastScan.textContent = "Waiting for first scan";
    els.monitorSourceCount.textContent = "0 active searches";
    els.monitorNewCount.textContent = "0 new listings";
    els.monitorBestCommute.textContent = "No qualifying listings yet";
    renderExcluded([]);
    renderActNow([], new Set());
    renderNew([]);
    renderStarred([], []);
    renderUnavailable([], []);
    renderMarket(null);

    if (monitorLoadState === "loading") {
      els.monitorStatusCopy.textContent = "Loading the latest scan.";
      els.monitorFeedState.textContent = "Loading.";
      return;
    }

    if (monitorLoadState === "error") {
      els.monitorStatusCopy.textContent = "Feed unreachable. No cached report on this device.";
      els.monitorFeedState.textContent = "Will fill in once the next scan syncs.";
      return;
    }

    els.monitorStatusCopy.textContent = "No scan run yet.";
    els.monitorFeedState.textContent = "Results will appear here once the scanner runs.";
    return;
  }

  const topListings = (Array.isArray(report.topListings) ? report.topListings : [])
    .map(withClientScore)
    .sort((a, b) => b.rankScore - a.rankScore);
  const newListingsRaw = Array.isArray(report.newListings) ? report.newListings : [];
  const sourceCount = report.sourcesConfigured || 0;
  const best = topListings[0] || null;

  els.monitorLastRun.textContent = report.runAt ? formatDateTime(report.runAt) : "Waiting for first scan";
  if (els.globalLastScan) els.globalLastScan.textContent = els.monitorLastRun.textContent;
  els.monitorSourceCount.textContent = `${sourceCount} active search${sourceCount === 1 ? "" : "es"}`;
  els.monitorNewCount.textContent = `${newListingsRaw.length} new listing${newListingsRaw.length === 1 ? "" : "s"}`;
  els.monitorBestCommute.textContent = best?.commute?.office
    ? `${best.commute.office.minutes} min to office`
    : "No qualifying listings yet";
  const excludedListings = Array.isArray(report.excludedListings) ? report.excludedListings : [];
  renderExcluded(excludedListings);
  renderStarred(topListings, excludedListings);
  renderUnavailable(topListings, excludedListings);
  renderMarket(report.marketStats);

  // "New" is based on firstSeenAt falling on the same calendar day as the
  // last scan, not the transient per-run newListings array — that array is
  // empty whenever the report gets regenerated from cache (a display-only
  // fix, a vision re-classification pass, etc.) rather than a real scan, so
  // tying the New tab to it would blank the tab out on every such refresh.
  const isNew = (entry) => isSameUtcDay(entry.firstSeenAt, report.runAt);

  const earlyAction = (Array.isArray(report.earlyActionListings) ? report.earlyActionListings : [])
    .map(withClientScore)
    .filter((entry) => !getFeedback(entry.listing.url).unavailable);
  renderActNow(earlyAction, isNew);

  const newListings = applySortFilter(topListings.filter(isNew));
  renderNew(newListings, report.runAt);

  const filteredTopListings = applySortFilter(topListings);
  if (els.tabCountAll) els.tabCountAll.textContent = filteredTopListings.length ? `(${filteredTopListings.length})` : "";

  if (!sourceCount) {
    els.monitorStatusCopy.textContent = "No saved searches connected yet.";
    els.monitorFeedState.textContent = "Add search URLs to monitor/config.json.";
    return;
  }

  if (!topListings.length) {
    els.monitorStatusCopy.textContent = "Sources connected. Waiting on the first scan.";
    els.monitorFeedState.textContent = "No scored listings yet.";
    return;
  }

  if (!newListingsRaw.length) {
    els.monitorStatusCopy.textContent = "No new listings this pass. Showing current top matches.";
    els.monitorFeedState.textContent = "";
  } else {
    els.monitorStatusCopy.textContent =
      `${newListingsRaw.length} new listing${newListingsRaw.length === 1 ? "" : "s"} this scan.`;
    els.monitorFeedState.textContent = "";
  }

  if (!filteredTopListings.length) {
    els.monitorFeedState.textContent = "No listings match the current sort/filter.";
  }

  const fragment = document.createDocumentFragment();
  filteredTopListings.forEach((entry) => {
    const flags = [];
    if (entry.needsEarlyAction) flags.push({ label: "Act Now", className: "flag-act-now" });
    if (isNew(entry)) flags.push({ label: `New as of ${formatDateOnly(report.runAt)}`, className: "flag-new" });
    fragment.append(buildListingCard(entry, flags));
  });
  els.monitorFeed.append(fragment);
}

function buildListingCard(entry, flags = []) {
  const node = els.monitorTemplate.content.firstElementChild.cloneNode(true);
  const screenshot = resolveMonitorAssetPath(entry.listing.externalScreenshot);
  const heroImage = entry.listing.photos?.[0] || screenshot || "";
  const officeCommute = entry.commute?.office;

  const flagsRow = node.querySelector(".monitor-flags");
  flags.forEach(({ label, className }) => {
    const flag = document.createElement("span");
    flag.className = `card-flag ${className}`;
    flag.textContent = label;
    flagsRow.append(flag);
  });

  const titleLink = node.querySelector(".monitor-name");
  titleLink.textContent = entry.listing.title;
  titleLink.href = entry.listing.url;
  node.querySelector(".monitor-subhead").textContent = `${entry.listing.address || "Address unknown"} • ${formatCurrency(entry.listing.price)}`;

  const scoreBadge = node.querySelector(".monitor-score");
  if (Number.isFinite(entry.rankScore)) {
    scoreBadge.textContent = `${Math.round(entry.rankScore)}/100`;
    scoreBadge.title = `Match score: ${Math.round(currentWeights.neighborhood)}% neighborhood preference, ${Math.round(currentWeights.office)}% office commute, ${Math.round(currentWeights.friends)}% commute to friends`;
  } else {
    scoreBadge.textContent = officeCommute ? `${officeCommute.minutes} min` : "commute unknown";
  }

  const heroLink = node.querySelector(".monitor-shot-link");
  heroLink.href = entry.listing.url;
  const hero = node.querySelector(".monitor-shot");
  if (heroImage) {
    hero.src = heroImage;
    hero.alt = `${entry.listing.title} preview`;
    hero.style.display = "block";
  } else {
    heroLink.style.display = "none";
  }

  const photoRow = node.querySelector(".monitor-photo-row");
  (entry.listing.photos || [])
    .slice(heroImage === screenshot ? 0 : 1, 4)
    .forEach((photo) => {
      const image = document.createElement("img");
      image.className = "monitor-thumb";
      image.src = photo;
      image.alt = `${entry.listing.title} photo`;
      photoRow.append(image);
    });

  const facts = node.querySelector(".monitor-facts");
  [
    entry.listing.neighborhood || null,
    entry.listing.bedrooms !== null ? `${entry.listing.bedrooms} bed` : "Beds unknown",
    entry.listing.bathrooms ? `${entry.listing.bathrooms} bath` : null,
    entry.listing.sqft ? `${entry.listing.sqft} sf` : null,
    formatAvailability(entry.listing.availableDate),
    formatLabel("W/D", entry.listing.washerDryer),
    formatLabel("Kitchen", entry.kitchenLayout),
    entry.kitchenSize && entry.kitchenSize !== "unknown" ? formatLabel("Kitchen size", entry.kitchenSize) : null,
    formatLabel("Gas", entry.gasStove),
    entry.hasGarden ? "Private garden" : null,
    entry.livingRoomSmall ? "Living room looks small" : null,
  ]
    .filter(Boolean)
    .forEach((label) => facts.append(createPill(label, "fact-pill")));

  const commuteRow = node.querySelector(".monitor-commute");
  [
    ["Office", entry.commute?.office],
    ["UWS friend", entry.commute?.upperWestSide],
    ["Morningside Heights", entry.commute?.morningsideHeights],
    ["LIC friend (Hunters Pt)", entry.commute?.longIslandCity],
    ["Prospect Heights", entry.commute?.prospectHeights],
  ]
    .map(([label, commute]) => (commute ? `${label}: ${commute.minutes} min${commute.lines?.length ? ` (${commute.lines.join("/")})` : ""}` : null))
    .filter(Boolean)
    .forEach((label) => commuteRow.append(createPill(label, "fact-pill")));

  const breakdownEl = node.querySelector(".monitor-rank-breakdown");
  const breakdownLabel = node.querySelector(".monitor-rank-label");
  const breakdown = entry.rankBreakdown;
  if (breakdown) {
    const NEIGHBORHOOD_TIER_LABEL = {
      uwsIdeal: "UWS 70s-80s",
      uwsAcceptable: "UWS, outside 70s-80s",
      brooklyn: "Brooklyn",
      other: "other area",
      unknown: "unrated area",
    };
    [
      `Neighborhood (${NEIGHBORHOOD_TIER_LABEL[breakdown.neighborhood.tier] || breakdown.neighborhood.tier}): ${Math.round(breakdown.neighborhood.score)} · ${Math.round(breakdown.neighborhood.weight * 100)}% weight`,
      `Office: ${Math.round(breakdown.office.score)} · ${Math.round(breakdown.office.weight * 100)}% weight`,
      `Friends: ${Math.round(breakdown.friends.score)} · ${Math.round(breakdown.friends.weight * 100)}% weight`,
      `Size: ${Math.round(breakdown.size.score)} · ${Math.round(breakdown.size.weight * 100)}% weight`,
      `Living room: ${Math.round(breakdown.livingRoom.score)} · ${Math.round(breakdown.livingRoom.weight * 100)}% weight`,
      `Kitchen size: ${Math.round(breakdown.kitchenSize.score)} · ${Math.round(breakdown.kitchenSize.weight * 100)}% weight`,
    ].forEach((label) => breakdownEl.append(createPill(label, "score-pill")));
  } else if (breakdownLabel) {
    breakdownLabel.style.display = "none";
  }

  node.querySelector(".monitor-why").textContent = entry.visionNotes || entry.listing.description?.slice(0, 240) || "";

  const link = node.querySelector(".monitor-link");
  link.href = entry.listing.url;

  wireStarAndNote(node, entry.listing.url, entry.listing.title, ".monitor-star", ".monitor-note", ".monitor-unavailable");

  return node;
}

// Shared by the full card template and the excluded-row template — reads
// current state from feedbackState, wires the star toggle and note field to
// write straight back through setFeedback (which persists to localStorage
// immediately, no separate save step).
function wireStarAndNote(node, url, title, starSelector, noteSelector, unavailableSelector) {
  const starButton = node.querySelector(starSelector);
  const noteField = node.querySelector(noteSelector);
  const unavailableButton = unavailableSelector ? node.querySelector(unavailableSelector) : null;
  const feedback = getFeedback(url);

  if (starButton) {
    starButton.textContent = feedback.starred ? "★" : "☆";
    starButton.classList.toggle("starred", feedback.starred);
    starButton.addEventListener("click", () => {
      const next = !getFeedback(url).starred;
      setFeedback(url, title, { starred: next });
      starButton.textContent = next ? "★" : "☆";
      starButton.classList.toggle("starred", next);
      refreshStarredTab();
    });
  }

  if (noteField) {
    noteField.value = feedback.note || "";
    noteField.addEventListener("change", () => {
      setFeedback(url, title, { note: noteField.value.trim() });
      refreshStarredTab();
    });
  }

  if (unavailableButton) {
    unavailableButton.textContent = feedback.unavailable ? "Available again" : "Mark unavailable";
    unavailableButton.classList.toggle("marked-unavailable", Boolean(feedback.unavailable));
    unavailableButton.addEventListener("click", () => {
      const next = !getFeedback(url).unavailable;
      setFeedback(url, title, { unavailable: next });
      // Unlike star/note, this changes what's actually filtered into the
      // main feeds (not just the Starred side-list), so it needs the real
      // re-render, not just a targeted refresh.
      renderMonitor();
    });
  }
}

// Re-derives the Starred tab from the last-loaded report without a full
// renderMonitor() pass — starring/noting a card is a discrete action that
// shouldn't rebuild every other card on the page (loses scroll position,
// re-triggers the card entry animation, etc.) just to keep one other tab
// in sync.
function refreshStarredTab() {
  const report = latestMonitorReport;
  if (!report) return;
  const topListings = (Array.isArray(report.topListings) ? report.topListings : []).map(withClientScore);
  const excludedListings = Array.isArray(report.excludedListings) ? report.excludedListings : [];
  renderStarred(topListings, excludedListings);
}

function renderActNow(earlyActionListings, isNew) {
  if (!els.actNowPanel || !els.actNowFeed) return;

  els.actNowFeed.innerHTML = "";
  if (els.tabCountActNow) els.tabCountActNow.textContent = earlyActionListings.length ? `(${earlyActionListings.length})` : "";
  if (els.actNowCount) els.actNowCount.textContent = earlyActionListings.length ? `(${earlyActionListings.length})` : "";

  if (!earlyActionListings.length) {
    if (els.actNowEmptyState) els.actNowEmptyState.textContent = "Nothing needs an early decision right now.";
    return;
  }

  if (els.actNowEmptyState) els.actNowEmptyState.textContent = "";

  const runAt = latestMonitorReport?.runAt;
  const fragment = document.createDocumentFragment();
  earlyActionListings.forEach((entry) => {
    const flags = [{ label: "Act Now", className: "flag-act-now" }];
    if (isNew(entry)) flags.push({ label: `New as of ${formatDateOnly(runAt)}`, className: "flag-new" });
    fragment.append(buildListingCard(entry, flags));
  });
  els.actNowFeed.append(fragment);
}

function renderNew(newListings, runAt) {
  if (!els.newFeed) return;

  els.newFeed.innerHTML = "";
  if (els.tabCountNew) els.tabCountNew.textContent = newListings.length ? `(${newListings.length})` : "";
  if (els.newCount) els.newCount.textContent = newListings.length ? `(${newListings.length})` : "";

  if (!newListings.length) {
    if (els.newEmptyState) els.newEmptyState.textContent = "No new qualifying listings since the last scan.";
    return;
  }

  if (els.newEmptyState) els.newEmptyState.textContent = "";

  const fragment = document.createDocumentFragment();
  newListings.forEach((entry) => {
    const flags = [{ label: `New as of ${formatDateOnly(runAt)}`, className: "flag-new" }];
    if (entry.needsEarlyAction) flags.push({ label: "Act Now", className: "flag-act-now" });
    fragment.append(buildListingCard(entry, flags));
  });
  els.newFeed.append(fragment);
}

function buildExcludedRow(entry) {
  const node = els.excludedTemplate.content.firstElementChild.cloneNode(true);
  const nameLink = node.querySelector(".excluded-name");
  nameLink.textContent = entry.listing.title;
  nameLink.href = entry.listing.url;
  node.querySelector(".excluded-subhead").textContent =
    `${entry.listing.address || "Address unknown"}${entry.listing.price ? ` • ${formatCurrency(entry.listing.price)}` : ""}`;

  const reasons = node.querySelector(".excluded-reasons");
  (entry.reasons || []).forEach((reason) => reasons.append(createPill(reason, "fact-pill excluded-reason-pill")));

  wireStarAndNote(node, entry.listing.url, entry.listing.title, ".excluded-star", ".excluded-note", ".excluded-unavailable");

  return node;
}

function renderExcluded(excludedListings) {
  if (!els.excludedList || !els.excludedTemplate) return;

  els.excludedList.innerHTML = "";
  els.excludedCount.textContent = `(${excludedListings.length})`;

  const fragment = document.createDocumentFragment();
  excludedListings.forEach((entry) => fragment.append(buildExcludedRow(entry)));
  els.excludedList.append(fragment);
}

function renderStarred(qualifyingEntries, excludedEntries) {
  if (!els.starredFeed) return;

  const starredQualifying = qualifyingEntries.filter((entry) => getFeedback(entry.listing.url).starred);
  const starredExcluded = excludedEntries.filter((entry) => getFeedback(entry.listing.url).starred);
  const total = starredQualifying.length + starredExcluded.length;

  els.starredFeed.innerHTML = "";
  if (els.starredExcludedList) els.starredExcludedList.innerHTML = "";
  if (els.tabCountStarred) els.tabCountStarred.textContent = total ? `(${total})` : "";
  if (els.starredCount) els.starredCount.textContent = total ? `(${total})` : "";

  if (!total) {
    if (els.starredEmptyState) els.starredEmptyState.textContent = "Nothing starred yet — click the ☆ on any card.";
    return;
  }
  if (els.starredEmptyState) els.starredEmptyState.textContent = "";

  const fragment = document.createDocumentFragment();
  starredQualifying.forEach((entry) => {
    const flags = getFeedback(entry.listing.url).unavailable ? [{ label: "Gone", className: "flag-unavailable" }] : [];
    fragment.append(buildListingCard(entry, flags));
  });
  els.starredFeed.append(fragment);

  if (els.starredExcludedList) {
    const excludedFragment = document.createDocumentFragment();
    starredExcluded.forEach((entry) => excludedFragment.append(buildExcludedRow(entry)));
    els.starredExcludedList.append(excludedFragment);
  }
}

// Two independent sources feed into "unavailable": you clicking the mark-
// unavailable button (tracked client-side in localStorage), or the
// automated revalidation pass in scan.cjs detecting the listing itself is
// gone/in-contract on StreetEasy (tracked server-side via the exclusion
// reason). Both mean the same thing to you — a unit you once considered
// isn't gettable anymore — so both belong in the same tab.
const AUTO_UNAVAILABLE_REASON_PATTERN = /no longer listed on streeteasy|in contract on streeteasy|rented on streeteasy/i;

function isAutoDetectedUnavailable(entry) {
  return (entry.reasons || []).some((reason) => AUTO_UNAVAILABLE_REASON_PATTERN.test(reason));
}

function isUnavailable(entry) {
  return getFeedback(entry.listing.url).unavailable || isAutoDetectedUnavailable(entry);
}

function renderUnavailable(qualifyingEntries, excludedEntries) {
  if (!els.unavailableFeed) return;

  const unavailableQualifying = qualifyingEntries.filter(isUnavailable);
  const unavailableExcluded = excludedEntries.filter(isUnavailable);
  const total = unavailableQualifying.length + unavailableExcluded.length;

  els.unavailableFeed.innerHTML = "";
  if (els.unavailableExcludedList) els.unavailableExcludedList.innerHTML = "";
  if (els.tabCountUnavailable) els.tabCountUnavailable.textContent = total ? `(${total})` : "";
  if (els.unavailableCount) els.unavailableCount.textContent = total ? `(${total})` : "";

  if (!total) {
    if (els.unavailableEmptyState) els.unavailableEmptyState.textContent = "Nothing marked unavailable.";
    return;
  }
  if (els.unavailableEmptyState) els.unavailableEmptyState.textContent = "";

  const fragment = document.createDocumentFragment();
  unavailableQualifying.forEach((entry) => fragment.append(buildListingCard(entry)));
  els.unavailableFeed.append(fragment);

  if (els.unavailableExcludedList) {
    const excludedFragment = document.createDocumentFragment();
    unavailableExcluded.forEach((entry) => excludedFragment.append(buildExcludedRow(entry)));
    els.unavailableExcludedList.append(excludedFragment);
  }
}

function formatStat(value, suffix) {
  return Number.isFinite(value) ? `${Math.round(value * 10) / 10}${suffix || ""}` : "—";
}

function renderMarket(marketStats) {
  if (!els.marketTiers) return;

  els.marketTiers.innerHTML = "";

  const areas = marketStats?.areas || [];
  if (!areas.length) {
    els.marketTiers.innerHTML = '<p class="empty-state">No data yet.</p>';
    if (els.marketContractSpeed) els.marketContractSpeed.textContent = "";
    return;
  }

  const fragment = document.createDocumentFragment();
  areas.forEach((area) => {
    const card = document.createElement("article");
    card.className = "market-tier-card";
    const rows = [
      ["Listings", `${area.count}`],
      ["Median rent", Number.isFinite(area.medianPrice) ? formatCurrency(area.medianPrice) : "—"],
      ["Median $/sqft", Number.isFinite(area.medianPricePerSqft) ? `$${formatStat(area.medianPricePerSqft, "")}` : "—"],
      ["Median days on market", formatStat(area.medianDaysOnMarket, " days")],
      ["Median lead time", formatStat(area.medianLeadTimeDays, " days")],
    ];
    card.innerHTML = `<h3>${area.name}</h3>${rows
      .map(([label, value]) => `<div class="market-stat-row"><span class="market-stat-label">${label}</span><span>${value}</span></div>`)
      .join("")}`;
    fragment.append(card);
  });
  els.marketTiers.append(fragment);

  if (els.marketContractSpeed) {
    const speed = marketStats?.contractSpeed;
    if (!speed?.sampleSize) {
      els.marketContractSpeed.textContent = "Not enough gone listings tracked yet to estimate how fast units are moving.";
    } else if (Number.isFinite(speed.medianDaysOnMarket)) {
      els.marketContractSpeed.textContent = `Based on ${speed.sampleSize} listing${speed.sampleSize === 1 ? "" : "s"} that went into contract or came down: median ${formatStat(speed.medianDaysOnMarket, " days")} on market first.`;
    } else {
      els.marketContractSpeed.textContent = `${speed.sampleSize} listing${speed.sampleSize === 1 ? "" : "s"} tracked as gone so far, but days-on-market data hasn't populated for them yet.`;
    }
  }

  renderMarketTrend();
}

let marketHistoryLoaded = false;

async function renderMarketTrend() {
  if (!els.marketTrendChart || marketHistoryLoaded) return;
  marketHistoryLoaded = true;

  try {
    const response = await fetch(`./monitor-output/market-history.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`market-history fetch failed (${response.status})`);
    const history = await response.json();
    drawMarketTrendChart(Array.isArray(history) ? history : []);
  } catch (error) {
    console.warn("Market history fetch failed", error);
    drawMarketTrendChart([]);
  }
}

// A minimal inline SVG line chart, no charting library — consistent with
// the rest of this buildless app. Tracks median rent for the two tiers
// with the most listings (usually Brooklyn and "other"), since those are
// the ones with enough volume for a median to mean anything early on.
function drawMarketTrendChart(history) {
  if (!els.marketTrendChart) return;
  els.marketTrendChart.innerHTML = "";

  if (history.length < 2) {
    if (els.marketTrendEmptyState) {
      els.marketTrendEmptyState.textContent =
        history.length === 0
          ? "No history yet — this fills in automatically as scans run over the coming days/weeks."
          : "Only one data point so far — check back after a few more scans.";
    }
    return;
  }
  if (els.marketTrendEmptyState) els.marketTrendEmptyState.textContent = "";

  const areaCounts = {};
  history.forEach((snapshot) => {
    (snapshot.areas || []).forEach((area) => {
      areaCounts[area.name] = (areaCounts[area.name] || 0) + area.count;
    });
  });
  // Most data-rich areas first — these will also have the least noisy
  // medians early on, before enough history has built up.
  const topAreas = Object.entries(areaCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([name]) => name);

  const colors = ["#4f6d5c", "#a0654f"];
  const width = 640;
  const height = 220;
  const padding = { top: 10, right: 16, bottom: 24, left: 56 };

  const series = topAreas.map((name) => {
    const points = history
      .map((snapshot) => {
        const match = (snapshot.areas || []).find((a) => a.name === name);
        return match && Number.isFinite(match.medianPrice) ? { runAt: snapshot.runAt, price: match.medianPrice } : null;
      })
      .filter(Boolean);
    return { name, label: name, points };
  });

  const allPrices = series.flatMap((s) => s.points.map((p) => p.price));
  if (!allPrices.length) {
    if (els.marketTrendEmptyState) els.marketTrendEmptyState.textContent = "Not enough priced history yet.";
    return;
  }
  const minPrice = Math.min(...allPrices) * 0.95;
  const maxPrice = Math.max(...allPrices) * 1.05;
  const minTime = new Date(history[0].runAt).getTime();
  const maxTime = new Date(history[history.length - 1].runAt).getTime();

  const xFor = (runAt) => {
    const t = new Date(runAt).getTime();
    if (maxTime === minTime) return padding.left;
    return padding.left + ((t - minTime) / (maxTime - minTime)) * (width - padding.left - padding.right);
  };
  const yFor = (price) => {
    if (maxPrice === minPrice) return height - padding.bottom;
    return height - padding.bottom - ((price - minPrice) / (maxPrice - minPrice)) * (height - padding.top - padding.bottom);
  };

  const lines = series
    .map((s, i) => {
      if (s.points.length < 2) return "";
      const d = s.points.map((p, idx) => `${idx === 0 ? "M" : "L"}${xFor(p.runAt).toFixed(1)},${yFor(p.price).toFixed(1)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="2" />`;
    })
    .join("");

  const legend = series
    .map(
      (s, i) =>
        `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:0.85rem;">
          <span style="width:10px;height:10px;border-radius:50%;background:${colors[i % colors.length]};display:inline-block;"></span>
          ${s.label}
        </span>`
    )
    .join("");

  els.marketTrendChart.innerHTML = `
    <div style="margin-bottom:8px;">${legend}</div>
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;max-width:${width}px;">
      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="var(--border)" />
      ${lines}
    </svg>
  `;
}

function createPill(text, className) {
  const pill = document.createElement("span");
  pill.className = className;
  pill.textContent = text;
  return pill;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatLabel(label, value) {
  if (!value) return null;
  if (value === "yes") return `${label}: yes`;
  if (value === "no") return `${label}: no`;
  if (value === "semi-open") return `${label}: semi-open`;
  return `${label}: ${value}`;
}

function formatAvailability(availableDate) {
  if (!availableDate) return null;
  if (availableDate === "now") return "Available now";
  return `Available ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${availableDate}T00:00:00`))}`;
}

function resolveMonitorAssetPath(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (!isLocalMonitorAssetHost()) return "";
  if (value.startsWith("monitor-output/")) return value;
  return `monitor-output/${value.replace(/^\.?\//, "")}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDateOnly(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function isSameUtcDay(a, b) {
  if (!a || !b) return false;
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;

  window.addEventListener("load", async () => {
    try {
      // Without updateViaCache: "none", the browser can check for a new
      // sw.js using its own HTTP-cached copy of that file, meaning it can
      // report "no update" without ever actually asking the network —
      // separate from (and a possible cause of) the report staleness this
      // was fixed alongside.
      await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  });
}

function syncMonitorLinks() {
  if (!els.monitorActions || !els.openFullReport || !els.openScanSummary) return;

  if (!isLocalMonitorAssetHost()) {
    els.monitorActions.hidden = true;
    return;
  }

  els.monitorActions.hidden = false;
  els.openFullReport.href = "monitor-output/latest-report.html";
  els.openScanSummary.href = "monitor-output/latest-summary.md";
}

function isLocalMonitorAssetHost() {
  return (
    location.protocol === "file:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1"
  );
}
