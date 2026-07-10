const path = require("path");
const { escapeHtml, formatCurrency, formatTimestamp } = require("./util.cjs");

const DESTINATION_LABELS = {
  office: "Office",
  upperWestSide: "UWS friend",
  morningsideHeights: "Morningside Heights",
  longIslandCity: "LIC",
  prospectHeights: "Prospect Heights",
};

function renderPills(values, className) {
  return values
    .filter(Boolean)
    .map((value) => `<span class="${className}">${escapeHtml(value)}</span>`)
    .join("");
}

function buildFactPills(entry) {
  const listing = entry.listing;
  return [
    listing.price ? formatCurrency(listing.price) : "Price not parsed",
    listing.bedrooms !== null ? `${listing.bedrooms} bed` : "Beds unknown",
    listing.bathrooms ? `${listing.bathrooms} bath` : null,
    listing.sqft ? `${listing.sqft} sf` : null,
    listing.neighborhood || null,
    `W/D: ${listing.washerDryer}`,
    `Kitchen: ${entry.kitchenLayout}`,
    `Gas: ${entry.gasStove}`,
  ];
}

function buildCommutePills(entry) {
  return Object.entries(DESTINATION_LABELS).map(([key, label]) => {
    const commute = entry.commute?.[key];
    if (!commute) return null;
    const lines = commute.lines?.length ? ` (${commute.lines.join("/")})` : "";
    return `${label}: ${commute.minutes} min${lines}`;
  });
}

function buildSummary(report) {
  const lines = [
    `Run time: ${formatTimestamp(report.runAt)}`,
    `Configured sources: ${report.sourcesConfigured}`,
    `New listings inspected this run: ${report.newListings.length}`,
    `Qualifying new listings: ${report.newListings.filter((entry) => entry.qualifies).length}`,
  ];

  const qualifying = report.newListings.filter((entry) => entry.qualifies);

  if (!qualifying.length) {
    lines.push("No new qualifying listings this run.");
  } else {
    qualifying.slice(0, 8).forEach((entry) => {
      const listing = entry.listing;
      const officeMinutes = entry.commute?.office?.minutes;
      const scoreLabel = Number.isFinite(entry.rankScore) ? ` | score ${Math.round(entry.rankScore)}/100` : "";
      lines.push(
        `- ${listing.title} | ${formatCurrency(listing.price)} | ${listing.address || "address unknown"}${officeMinutes ? ` | ${officeMinutes} min to office` : ""}${scoreLabel}`
      );
    });
  }

  return lines.join("\n");
}

function generateMarkdownReport(report) {
  const sections = [
    "# Future Elmo's World Monitor",
    "",
    buildSummary(report),
    "",
    "## Qualifying Listings",
    "",
  ];

  report.topListings.forEach((entry) => {
    const listing = entry.listing;
    const officeMinutes = entry.commute?.office?.minutes;
    const scoreLabel = Number.isFinite(entry.rankScore) ? ` | score ${Math.round(entry.rankScore)}/100` : "";
    sections.push(
      `- ${listing.title} | ${formatCurrency(listing.price)} | ${listing.address || "address unknown"}${officeMinutes ? ` | ${officeMinutes} min to office` : ""}${scoreLabel}`
    );
  });

  sections.push("", `## Excluded (${(report.excludedListings || []).length})`, "");

  (report.excludedListings || []).forEach((entry) => {
    const listing = entry.listing;
    sections.push(`- ${listing.title} | ${listing.address || "address unknown"} — ${entry.reasons.join("; ")}`);
  });

  return sections.join("\n");
}

function generateHtmlReport(report) {
  const cards = report.topListings
    .map((entry) => {
      const listing = entry.listing;
      const localScreenshot = listing.externalScreenshot
        ? `<img class="hero-shot" src="${encodeURI(listing.externalScreenshot)}" alt="Listing screenshot for ${escapeHtml(listing.title)}" />`
        : "";
      const remotePhotos = listing.photos
        .slice(0, 4)
        .map(
          (photo) =>
            `<img class="thumb" src="${escapeHtml(photo)}" loading="lazy" alt="Listing photo for ${escapeHtml(
              listing.title
            )}" />`
        )
        .join("");
      const officeMinutes = entry.commute?.office?.minutes;
      const scoreLabel = Number.isFinite(entry.rankScore)
        ? `${Math.round(entry.rankScore)}/100`
        : officeMinutes
        ? `${officeMinutes} min`
        : "";
      const breakdown = entry.rankBreakdown;
      const NEIGHBORHOOD_TIER_LABEL = { uws: "UWS", brooklyn: "Brooklyn", other: "other area", unknown: "unrated area" };
      const breakdownText = breakdown
        ? `Match score ${Math.round(breakdown.total)}/100 — ` +
          `Neighborhood (${NEIGHBORHOOD_TIER_LABEL[breakdown.neighborhood.tier] || breakdown.neighborhood.tier}): ${Math.round(breakdown.neighborhood.score)} × ${Math.round(breakdown.neighborhood.weight * 100)}%, ` +
          `Office: ${Math.round(breakdown.office.score)} × ${Math.round(breakdown.office.weight * 100)}%, ` +
          `Friends: ${Math.round(breakdown.friends.score)} × ${Math.round(breakdown.friends.weight * 100)}%`
        : "";

      return `
        <article class="card">
          <div class="card-top">
            <div>
              <h2><a href="${escapeHtml(listing.url)}" target="_blank" rel="noreferrer">${escapeHtml(
                listing.title
              )}</a></h2>
              <p class="subhead">${escapeHtml(listing.address || "Address unknown")}</p>
            </div>
            ${scoreLabel ? `<div class="score">${escapeHtml(scoreLabel)}</div>` : ""}
          </div>
          ${localScreenshot}
          <div class="thumb-row">${remotePhotos}</div>
          <div class="facts">${renderPills(buildFactPills(entry), "pill fact")}</div>
          <div class="facts">${renderPills(buildCommutePills(entry), "pill plus")}</div>
          ${breakdownText ? `<p class="rank-breakdown">${escapeHtml(breakdownText)}</p>` : ""}
          <p class="body">${escapeHtml(listing.description || listing.bodyText || "").slice(0, 620)}</p>
        </article>
      `;
    })
    .join("");

  const excludedRows = (report.excludedListings || [])
    .map(
      (entry) => `
        <div class="excluded-row">
          <a href="${escapeHtml(entry.listing.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.listing.title)}</a>
          <span class="excluded-reason">${escapeHtml(entry.reasons.join("; "))}</span>
        </div>
      `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Future Elmo's World Monitor</title>
    <style>
      :root {
        --bg: #0b1220;
        --panel: #121c30;
        --line: rgba(255,255,255,0.08);
        --text: #f6efe6;
        --muted: #b7b0a7;
        --accent: #f2aa55;
        --mint: #95e0c4;
        --rose: #ff9f9f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(242,170,85,0.14), transparent 30%),
          radial-gradient(circle at bottom right, rgba(149,224,196,0.14), transparent 30%),
          linear-gradient(180deg, #0e1628 0%, #09101c 100%);
        color: var(--text);
      }
      main {
        width: min(1180px, calc(100% - 28px));
        margin: 0 auto;
        padding: 28px 0 48px;
      }
      .hero, .card {
        background: rgba(18, 28, 48, 0.88);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: 0 24px 70px rgba(0,0,0,0.28);
      }
      .hero {
        padding: 24px;
        margin-bottom: 20px;
      }
      h1, h2 {
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        letter-spacing: -0.03em;
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(2.6rem, 6vw, 4.8rem);
      }
      h2 {
        margin: 0;
        font-size: 1.5rem;
      }
      .hero p, .subhead, .body, .meta {
        color: var(--muted);
        line-height: 1.55;
      }
      .summary {
        white-space: pre-wrap;
        font-family: ui-monospace, "SFMono-Regular", monospace;
        background: rgba(255,255,255,0.03);
        border: 1px solid var(--line);
        padding: 16px;
        border-radius: 16px;
      }
      .grid {
        display: grid;
        gap: 16px;
      }
      .card {
        padding: 18px;
      }
      .card-top {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      .score {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: rgba(149,224,196,0.14);
        color: var(--mint);
        min-width: 62px;
      }
      .hero-shot {
        display: block;
        width: 100%;
        margin-top: 16px;
        border-radius: 16px;
        border: 1px solid var(--line);
      }
      .thumb-row {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        margin-top: 12px;
      }
      .thumb {
        width: 100%;
        height: 140px;
        object-fit: cover;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.04);
      }
      .facts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }
      .pill {
        border-radius: 999px;
        padding: 8px 10px;
        border: 1px solid var(--line);
        font-size: 0.88rem;
      }
      .fact { color: var(--muted); }
      .plus {
        color: var(--mint);
        background: rgba(149,224,196,0.09);
      }
      a {
        color: var(--text);
        text-decoration: none;
      }
      a:hover {
        color: var(--accent);
      }
      @media (max-width: 800px) {
        .card-top {
          flex-direction: column;
        }
      }
      .excluded {
        margin-top: 20px;
        padding: 18px;
      }
      .excluded h2 {
        margin-bottom: 4px;
      }
      .excluded-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 0;
        border-top: 1px solid var(--line);
        font-size: 0.9rem;
      }
      .excluded-row a {
        flex-shrink: 0;
      }
      .excluded-reason {
        color: var(--rose);
        text-align: right;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>Future Elmo's World Monitor</h1>
        <p>Generated ${escapeHtml(formatTimestamp(report.runAt))}.</p>
        <div class="summary">${escapeHtml(buildSummary(report))}</div>
        <p class="meta">Report file: ${escapeHtml(path.basename(report.htmlPath))} • Summary file: ${escapeHtml(path.basename(report.summaryPath))}</p>
      </section>
      <section class="grid">
        ${cards || `<div class="card"><p class="body">No qualifying listings yet. Add live search URLs in <code>monitor/config.json</code> and rerun the scanner.</p></div>`}
      </section>
      <section class="card excluded">
        <h2>Excluded (${(report.excludedListings || []).length})</h2>
        <p class="subhead">Inspected but didn't clear every requirement.</p>
        ${excludedRows || `<p class="body">Nothing excluded yet.</p>`}
      </section>
    </main>
  </body>
</html>`;
}

module.exports = {
  generateHtmlReport,
  generateMarkdownReport,
};
