# Background Scanner

The engine behind the web app. The person-facing entry point is still [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>); the scanner writes data files the main page loads.

## What It Does

- Reads public saved-search URLs from [config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>)
- Visits listing pages with Playwright plus your installed Chrome, reusing a bootstrapped session (see below) to get past StreetEasy's bot check
- Extracts address, price, beds/baths, and photos for each new listing
- Geocodes the address and gets real transit commute times + subway lines to 4 destinations via Google Directions
- Sends the listing photos to Claude to judge kitchen layout (open/semi-open/closed/galley) and stove type (gas/electric) — this isn't filterable on StreetEasy, so it has to come from the photos
- Excludes any listing that doesn't clear every hard requirement (budget, beds, in-unit W/D, open/semi-open kitchen) — no score, no partial credit
- Writes the qualifying shortlist to [latest-report.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.html>) and the app feed payload to [latest-report.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.js>)
- Optionally pushes the feed to a backend you deploy via [sync-report.cjs](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/sync-report.cjs>)
- Sends a macOS notification when new qualifying listings appear

## One-Time Setup

1. Install dependencies from the repo root: `npm install`
2. Create `monitor/.env` (gitignored) with:
   ```
   GOOGLE_MAPS_API_KEY=...
   ANTHROPIC_API_KEY=...
   ```
   The Google key needs the **Geocoding API** and **Directions API** enabled (and allowed on the key's own restriction list, not just the project). The Anthropic key needs a positive credit balance.
3. Paste your saved-search URL(s) into [config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>) and set `enabled: true`
4. Bootstrap a trusted browser session once:
   ```bash
   node monitor/bootstrap-session.cjs
   ```
   A real Chrome window opens to your search. Solve the "Press & Hold" human-check yourself, browse for a few seconds like a normal visitor, then press Enter in the terminal. This saves `monitor/.session-state.json` (gitignored), which every future automated scan reuses. Redo this whenever the session expires and scans start returning 0 listings again.

## Run Once

```bash
./monitor/run-scan.sh
```

If [monitor/.sync.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/.sync.json>) exists, this also pushes the latest report to your backend after the scan completes.

## Keep It Running

```bash
./monitor/watch-loop.sh 30
```

Reruns the scan every `30` minutes. Change the number for a different interval.

## Output Files

- [latest-report.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.html>)
- [latest-report.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.json>)
- [latest-summary.md](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-summary.md>)
- `state.json` (gitignored) — full catalog of every inspected listing, qualifying or not, so re-scans don't redo work or re-spend API calls

## Optional Backend Sync

Copy [monitor/.sync.example.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/.sync.example.json>) to `monitor/.sync.json` and fill in your backend's report endpoint and sync token. That file is gitignored so the token stays local. Not required — the static GitHub Pages deployment works without it.
