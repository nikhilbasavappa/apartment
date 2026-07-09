const path = require("path");
const { escapeHtml, formatCurrency, formatTimestamp } = require("./util.cjs");

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
    listing.commuteMinutes ? `${listing.commuteMinutes} min commute` : null,
    `W/D: ${listing.washerDryer}`,
    `Kitchen: ${listing.kitchenLayout}`,
    `Gas: ${listing.gasStove}`,
    listing.neighborhoodName,
  ];
}

function buildSummary(report) {
  const headlineHits = report.newListings.filter(
    (entry) => entry.label === "High Attention" || entry.label === "Photo Check" || entry.label === "Strong Candidate"
  );

  const lines = [
    `Run time: ${formatTimestamp(report.runAt)}`,
    `Configured sources: ${report.sourcesConfigured}`,
    `New listings inspected this run: ${report.newListings.length}`,
    `Shortlist-worthy new listings: ${headlineHits.length}`,
  ];

  if (!headlineHits.length) {
    lines.push("No new standout listings this run.");
  } else {
    headlineHits.slice(0, 8).forEach((entry) => {
      const listing = entry.listing;
      lines.push(
        `- ${entry.label}: ${listing.title} | ${formatCurrency(listing.price)} | ${listing.neighborhoodName} | ${Math.round(entry.score)}`
      );
    });
  }

  return lines.join("\n");
}

function generateMarkdownReport(report) {
  const sections = [
    "# Lex & Laundry Monitor",
    "",
    buildSummary(report),
    "",
    "## Recent Top Listings",
    "",
  ];

  report.topListings.slice(0, 12).forEach((entry) => {
    const listing = entry.listing;
    sections.push(
      `- **${entry.label}** ${listing.title} | ${formatCurrency(listing.price)} | ${listing.neighborhoodName} | score ${Math.round(entry.score)}`
    );
    if (entry.pluses.length) {
      sections.push(`  Signals: ${entry.pluses.join(", ")}`);
    }
    if (entry.issues.length) {
      sections.push(`  Watch-outs: ${entry.issues.join(", ")}`);
    }
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

      return `
        <article class="card">
          <div class="card-top">
            <div>
              <div class="label">${escapeHtml(entry.label)}</div>
              <h2><a href="${escapeHtml(listing.url)}" target="_blank" rel="noreferrer">${escapeHtml(
                listing.title
              )}</a></h2>
              <p class="subhead">${escapeHtml(listing.neighborhoodName)} • ${Math.round(entry.score)} score</p>
            </div>
            <div class="score">${Math.round(entry.score)}</div>
          </div>
          ${localScreenshot}
          <div class="thumb-row">${remotePhotos}</div>
          <div class="facts">${renderPills(buildFactPills(entry), "pill fact")}</div>
          <div class="facts">${renderPills(entry.pluses, "pill plus")}</div>
          <div class="facts">${renderPills(entry.issues, "pill issue")}</div>
          <p class="body">${escapeHtml(listing.description || listing.bodyText || "").slice(0, 620)}</p>
        </article>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lex & Laundry Monitor</title>
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
      .label, .score {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .label {
        background: rgba(242,170,85,0.14);
        color: var(--accent);
        margin-bottom: 10px;
      }
      .score {
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
      .issue {
        color: var(--rose);
        background: rgba(255,159,159,0.09);
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
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>Lex & Laundry Monitor</h1>
        <p>Generated ${escapeHtml(formatTimestamp(report.runAt))}. This is the recurring apartment finder: new listings in, photos and shortlist out.</p>
        <div class="summary">${escapeHtml(buildSummary(report))}</div>
        <p class="meta">Report file: ${escapeHtml(path.basename(report.htmlPath))} • Summary file: ${escapeHtml(path.basename(report.summaryPath))}</p>
      </section>
      <section class="grid">
        ${cards || `<div class="card"><p class="body">No scored listings yet. Add live search URLs in <code>monitor/config.json</code> and rerun the scanner.</p></div>`}
      </section>
    </main>
  </body>
</html>`;
}

module.exports = {
  generateHtmlReport,
  generateMarkdownReport,
};
