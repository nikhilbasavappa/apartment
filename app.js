let latestMonitorReport = window.__APARTMENT_REPORT__ || null;
let monitorLoadState = location.protocol === "file:" ? "ready" : "loading";
registerServiceWorker();

const els = {
  monitorLastRun: document.querySelector("#monitorLastRun"),
  monitorSourceCount: document.querySelector("#monitorSourceCount"),
  monitorNewCount: document.querySelector("#monitorNewCount"),
  monitorTopScore: document.querySelector("#monitorTopScore"),
  monitorStatusCopy: document.querySelector("#monitorStatusCopy"),
  monitorFeedState: document.querySelector("#monitorFeedState"),
  monitorFeed: document.querySelector("#monitorFeed"),
  monitorActions: document.querySelector("#monitorActions"),
  openFullReport: document.querySelector("#openFullReport"),
  openScanSummary: document.querySelector("#openScanSummary"),
  monitorTemplate: document.querySelector("#monitorTemplate"),
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
    els.monitorTopScore.textContent = "No scored listings yet";

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
  els.monitorTopScore.textContent = best
    ? `${Math.round(best.score)} in ${best.listing.neighborhoodName}`
    : "No scored listings yet";

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

  topListings.slice(0, 6).forEach((entry) => {
    const node = els.monitorTemplate.content.firstElementChild.cloneNode(true);
    const screenshot = resolveMonitorAssetPath(entry.listing.externalScreenshot);
    const heroImage = screenshot || entry.listing.photos?.[0] || "";

    node.querySelector(".monitor-decision").textContent = entry.label;
    node.querySelector(".monitor-name").textContent = entry.listing.title;
    node.querySelector(".monitor-subhead").textContent = `${entry.listing.neighborhoodName} • ${formatCurrency(entry.listing.price)} • ${entry.listing.commuteMinutes || "?"} min commute`;
    node.querySelector(".monitor-score").textContent = `${Math.round(entry.score)} score`;

    const hero = node.querySelector(".monitor-shot");
    if (heroImage) {
      hero.src = heroImage;
      hero.alt = `${entry.listing.title} preview`;
      hero.style.display = "block";
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
      entry.listing.bedrooms !== null ? `${entry.listing.bedrooms} bed` : "Beds unknown",
      entry.listing.bathrooms ? `${entry.listing.bathrooms} bath` : null,
      entry.listing.sqft ? `${entry.listing.sqft} sf` : null,
      formatLabel("W/D", entry.listing.washerDryer),
      formatLabel("Kitchen", entry.listing.kitchenLayout),
      formatLabel("Gas", entry.listing.gasStove),
    ]
      .filter(Boolean)
      .forEach((label) => facts.append(createPill(label, "fact-pill")));

    const whyParts = [];
    if (entry.pluses?.length) {
      whyParts.push(`Signals: ${entry.pluses.join(", ")}.`);
    }
    if (entry.listing.description) {
      whyParts.push(entry.listing.description.slice(0, 240));
    }
    node.querySelector(".monitor-why").textContent = whyParts.join(" ");

    const issues = node.querySelector(".monitor-issues");
    if (entry.issues?.length) {
      entry.issues.forEach((issue) => issues.append(createPill(issue, "issue-chip")));
    } else {
      issues.append(createPill("No major flags detected", "chip"));
    }

    const link = node.querySelector(".monitor-link");
    link.href = entry.listing.url;

    fragment.append(node);
  });

  els.monitorFeed.append(fragment);
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
