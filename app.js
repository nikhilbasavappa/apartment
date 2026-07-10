let latestMonitorReport = window.__APARTMENT_REPORT__ || null;
let monitorLoadState = location.protocol === "file:" ? "ready" : "loading";
registerServiceWorker();

const els = {
  monitorLastRun: document.querySelector("#monitorLastRun"),
  monitorSourceCount: document.querySelector("#monitorSourceCount"),
  monitorNewCount: document.querySelector("#monitorNewCount"),
  monitorBestCommute: document.querySelector("#monitorBestCommute"),
  monitorStatusCopy: document.querySelector("#monitorStatusCopy"),
  monitorFeedState: document.querySelector("#monitorFeedState"),
  monitorFeed: document.querySelector("#monitorFeed"),
  monitorActions: document.querySelector("#monitorActions"),
  openFullReport: document.querySelector("#openFullReport"),
  openScanSummary: document.querySelector("#openScanSummary"),
  monitorTemplate: document.querySelector("#monitorTemplate"),
  excludedCount: document.querySelector("#excludedCount"),
  excludedList: document.querySelector("#excludedList"),
  excludedTemplate: document.querySelector("#excludedTemplate"),
};

init();

function init() {
  syncMonitorLinks();
  void loadMonitorReport();
}

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
  const response = await fetch("./api/report", {
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

function renderMonitor() {
  if (!els.monitorFeed || !els.monitorFeedState) return;

  const report = latestMonitorReport;
  els.monitorFeed.innerHTML = "";

  if (!report) {
    els.monitorLastRun.textContent = "Waiting for first scan";
    els.monitorSourceCount.textContent = "0 active searches";
    els.monitorNewCount.textContent = "0 new listings";
    els.monitorBestCommute.textContent = "No qualifying listings yet";
    renderExcluded([]);

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

  const topListings = Array.isArray(report.topListings) ? report.topListings : [];
  const newListings = Array.isArray(report.newListings) ? report.newListings : [];
  const sourceCount = report.sourcesConfigured || 0;
  const best = topListings[0] || null;

  els.monitorLastRun.textContent = report.runAt ? formatDateTime(report.runAt) : "Waiting for first scan";
  els.monitorSourceCount.textContent = `${sourceCount} active search${sourceCount === 1 ? "" : "es"}`;
  els.monitorNewCount.textContent = `${newListings.length} new listing${newListings.length === 1 ? "" : "s"}`;
  els.monitorBestCommute.textContent = best?.commute?.office
    ? `${best.commute.office.minutes} min to office`
    : "No qualifying listings yet";
  renderExcluded(Array.isArray(report.excludedListings) ? report.excludedListings : []);

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

  if (!newListings.length) {
    els.monitorStatusCopy.textContent = "No new listings this pass. Showing current top matches.";
    els.monitorFeedState.textContent = "";
  } else {
    els.monitorStatusCopy.textContent =
      `${newListings.length} new listing${newListings.length === 1 ? "" : "s"} this scan.`;
    els.monitorFeedState.textContent = "";
  }

  const fragment = document.createDocumentFragment();

  topListings.forEach((entry) => {
    const node = els.monitorTemplate.content.firstElementChild.cloneNode(true);
    const screenshot = resolveMonitorAssetPath(entry.listing.externalScreenshot);
    const heroImage = entry.listing.photos?.[0] || screenshot || "";
    const officeCommute = entry.commute?.office;

    const titleLink = node.querySelector(".monitor-name");
    titleLink.textContent = entry.listing.title;
    titleLink.href = entry.listing.url;
    node.querySelector(".monitor-subhead").textContent = `${entry.listing.address || "Address unknown"} • ${formatCurrency(entry.listing.price)}`;

    const scoreBadge = node.querySelector(".monitor-score");
    if (Number.isFinite(entry.rankScore)) {
      scoreBadge.textContent = `${Math.round(entry.rankScore)}/100`;
      scoreBadge.title = "Match score: 35% neighborhood preference, 35% office commute, 30% commute to friends";
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
      formatLabel("W/D", entry.listing.washerDryer),
      formatLabel("Kitchen", entry.kitchenLayout),
      formatLabel("Gas", entry.gasStove),
    ]
      .filter(Boolean)
      .forEach((label) => facts.append(createPill(label, "fact-pill")));

    const commuteRow = node.querySelector(".monitor-commute");
    [
      ["Office", entry.commute?.office],
      ["UWS friend", entry.commute?.upperWestSide],
      ["Morningside Heights", entry.commute?.morningsideHeights],
      ["LIC", entry.commute?.longIslandCity],
      ["Prospect Heights", entry.commute?.prospectHeights],
    ]
      .map(([label, commute]) => (commute ? `${label}: ${commute.minutes} min${commute.lines?.length ? ` (${commute.lines.join("/")})` : ""}` : null))
      .filter(Boolean)
      .forEach((label) => commuteRow.append(createPill(label, "fact-pill")));

    const breakdownEl = node.querySelector(".monitor-rank-breakdown");
    const breakdown = entry.rankBreakdown;
    if (breakdown) {
      const NEIGHBORHOOD_TIER_LABEL = { uws: "UWS", brooklyn: "Brooklyn", other: "other area", unknown: "unrated area" };
      breakdownEl.textContent =
        `Match score ${Math.round(breakdown.total)}/100 — ` +
        `Neighborhood (${NEIGHBORHOOD_TIER_LABEL[breakdown.neighborhood.tier] || breakdown.neighborhood.tier}): ${Math.round(breakdown.neighborhood.score)} × ${Math.round(breakdown.neighborhood.weight * 100)}%, ` +
        `Office: ${Math.round(breakdown.office.score)} × ${Math.round(breakdown.office.weight * 100)}%, ` +
        `Friends: ${Math.round(breakdown.friends.score)} × ${Math.round(breakdown.friends.weight * 100)}%`;
    }

    node.querySelector(".monitor-why").textContent = entry.visionNotes || entry.listing.description?.slice(0, 240) || "";

    const link = node.querySelector(".monitor-link");
    link.href = entry.listing.url;

    fragment.append(node);
  });

  els.monitorFeed.append(fragment);
}

function renderExcluded(excludedListings) {
  if (!els.excludedList || !els.excludedTemplate) return;

  els.excludedList.innerHTML = "";
  els.excludedCount.textContent = `(${excludedListings.length})`;

  const fragment = document.createDocumentFragment();

  excludedListings.forEach((entry) => {
    const node = els.excludedTemplate.content.firstElementChild.cloneNode(true);
    const nameLink = node.querySelector(".excluded-name");
    nameLink.textContent = entry.listing.title;
    nameLink.href = entry.listing.url;
    node.querySelector(".excluded-subhead").textContent =
      `${entry.listing.address || "Address unknown"}${entry.listing.price ? ` • ${formatCurrency(entry.listing.price)}` : ""}`;

    const reasons = node.querySelector(".excluded-reasons");
    (entry.reasons || []).forEach((reason) => reasons.append(createPill(reason, "fact-pill excluded-reason-pill")));

    fragment.append(node);
  });

  els.excludedList.append(fragment);
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
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
