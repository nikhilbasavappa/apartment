#!/usr/bin/env node

const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");
const { resolveChromeExecutable } = require("./lib/adapters.cjs");
const { ensureDir, readJson } = require("./lib/util.cjs");

const configPath = path.join(__dirname, "config.json");
const browserProfileDir = path.join(__dirname, ".browser-profile");

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

  ensureDir(browserProfileDir);

  // Launched at the same profile directory the scanner itself uses, so
  // whatever you do here — solving the challenge, clicking around — becomes
  // part of a real, persistent Chrome profile (cookies, cache, local
  // storage, history) that every future automated run reuses as-is.
  const context = await chromium.launchPersistentContext(browserProfileDir, {
    executablePath: resolveChromeExecutable() || undefined,
    headless: false,
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: null,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--disable-dev-shm-usage",
      "--start-maximized",
    ],
  });

  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

  console.log("\nA real Chrome window just opened.");
  console.log("If you see a \"Press & Hold\" (or similar) human-check, solve it yourself.");
  console.log("Then browse around for a bit like a normal visitor — click a couple listings, scroll, wait a few seconds between actions.");
  console.log("The longer and more naturally you browse here, the more convincing the resulting profile is.");
  console.log("Once the page looks normal (real listings visible, no challenge), come back here.\n");

  await waitForEnter("Press Enter when you're done browsing... ");

  await context.close();
  console.log(`\nProfile saved to ${browserProfileDir}. The scanner will reuse it on every future run.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
