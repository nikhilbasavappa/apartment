#!/usr/bin/env node

const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");
const { resolveChromeExecutable } = require("./lib/adapters.cjs");
const { readJson } = require("./lib/util.cjs");

const workspaceRoot = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "config.json");
const statePath = path.join(__dirname, ".session-state.json");

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const config = readJson(configPath, null);
  const firstSource = config?.sources?.find((source) => source.url);
  const targetUrl = firstSource?.url || "https://streeteasy.com/";

  const chromeExecutable = resolveChromeExecutable();
  const browser = await chromium.launch({
    executablePath: chromeExecutable || undefined,
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--disable-dev-shm-usage",
      "--start-maximized",
    ],
  });

  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: null,
  });

  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

  console.log("\nA real Chrome window just opened.");
  console.log("If you see a \"Press & Hold\" (or similar) human-check, solve it yourself.");
  console.log("Then browse around for a few seconds like a normal visitor — click a listing, scroll a bit.");
  console.log("Once the page looks normal (real listings visible, no challenge), come back here.\n");

  await waitForEnter("Press Enter once you're through the challenge and see real listings... ");

  await context.storageState({ path: statePath });
  console.log(`\nSaved session to ${statePath}. The scanner will reuse this on future runs.`);

  await browser.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
