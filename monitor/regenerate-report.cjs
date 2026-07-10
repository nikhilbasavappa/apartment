#!/usr/bin/env node

// Rebuilds the report output files from the existing state.json catalog
// without hitting Bright Data / Google / Anthropic again — useful after a
// display-only change (report layout, caps, scoring re-read) when the
// underlying scan data hasn't changed.

const { buildReport, loadConfig, loadState, saveReport } = require("./scan.cjs");

const config = loadConfig();
const state = loadState();
const report = buildReport(state, state.lastRunAt || new Date().toISOString(), config, []);
saveReport(report);

console.log(
  `Regenerated report from cached state. ${report.topListings.length} qualifying, ${report.excludedListings.length} excluded.`
);
