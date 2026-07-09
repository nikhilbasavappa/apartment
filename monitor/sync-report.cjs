#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const workspaceRoot = path.resolve(__dirname, "..");
const reportPath = path.join(workspaceRoot, "monitor-output", "latest-report.json");
const syncConfigPath = path.join(__dirname, ".sync.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function toClientReport(report) {
  if (!report || typeof report !== "object") {
    return null;
  }

  const serializeEntry = (entry) => ({
    issues: Array.isArray(entry?.issues) ? entry.issues : [],
    label: entry?.label || "Watch",
    listing: {
      bathrooms: entry?.listing?.bathrooms ?? null,
      bedrooms: entry?.listing?.bedrooms ?? null,
      commuteMinutes: entry?.listing?.commuteMinutes ?? null,
      description: entry?.listing?.description || "",
      externalScreenshot: entry?.listing?.externalScreenshot || null,
      gasStove: entry?.listing?.gasStove || "unknown",
      kitchenLayout: entry?.listing?.kitchenLayout || "unknown",
      neighborhoodName: entry?.listing?.neighborhoodName || "Unknown",
      photos: Array.isArray(entry?.listing?.photos) ? entry.listing.photos : [],
      price: entry?.listing?.price ?? null,
      sqft: entry?.listing?.sqft ?? null,
      title: entry?.listing?.title || "Untitled listing",
      url: entry?.listing?.url || "",
      washerDryer: entry?.listing?.washerDryer || "unknown",
    },
    pluses: Array.isArray(entry?.pluses) ? entry.pluses : [],
    score: Number.isFinite(entry?.score) ? entry.score : 0,
  });

  return {
    newListings: Array.isArray(report.newListings) ? report.newListings.map(serializeEntry) : [],
    runAt: report.runAt || null,
    sourcesConfigured: report.sourcesConfigured || 0,
    topListings: Array.isArray(report.topListings) ? report.topListings.map(serializeEntry) : [],
  };
}

async function main() {
  const syncConfig = readJson(syncConfigPath, null);
  if (!syncConfig?.endpoint || !syncConfig?.token) {
    console.log("No live sync config found. Skipping hosted feed update.");
    return;
  }

  if (typeof fetch !== "function") {
    throw new Error("This Node runtime does not expose fetch().");
  }

  const report = toClientReport(readJson(reportPath, null));
  if (!report) {
    throw new Error(`Missing report payload at ${reportPath}`);
  }

  const response = await fetch(syncConfig.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${syncConfig.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ report }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Live publish failed (${response.status}): ${body.slice(0, 300)}`);
  }

  console.log(`Live report published to ${syncConfig.endpoint}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
