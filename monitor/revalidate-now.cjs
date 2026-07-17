#!/usr/bin/env node

// One-off: runs a much larger revalidation batch than a normal scan does,
// to clear through the current backlog now instead of waiting ~7 days for
// the twice-daily drip (20/run, built into scan.cjs) to cycle through the
// whole catalog on its own. Safe to re-run — picks up wherever a previous
// run left off via lastRevalidatedAt, same as the drip does.

const { loadConfig, loadState, createPersistentContext, revalidateQualifyingListings, buildReport, saveReport, statePath } = require("./scan.cjs");
const { writeJson } = require("./lib/util.cjs");

const BATCH_SIZE = Number(process.argv[2]) || 150;

async function main() {
  const config = loadConfig();
  config.scanner.revalidateBatchSize = BATCH_SIZE;
  const state = loadState();
  const runAt = new Date().toISOString();

  const context = await createPersistentContext(config);
  let result;
  try {
    result = await revalidateQualifyingListings(context, state, config, runAt);
  } finally {
    await context.close();
  }

  writeJson(statePath, state);
  const report = buildReport(state, state.lastRunAt || runAt, config, []);
  saveReport(report);

  console.log(
    `Done. ${result.checked} revalidated, ${result.removed} no longer available. ` +
      `Catalog now: ${report.topListings.length} qualifying, ${report.excludedListings.length} excluded.`
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
