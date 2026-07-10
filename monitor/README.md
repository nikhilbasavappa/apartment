# Background Scanner

The engine behind the web app. The person-facing entry point is still [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>); the scanner writes data files the main page loads.

## What It Does

- Reads public saved-search URLs from [config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>)
- Fetches listing pages through Bright Data's Web Unlocker API rather than navigating there directly — their infrastructure handles StreetEasy's bot detection server-side and hands back the rendered HTML, which Playwright then just parses locally (JavaScript disabled in that local context; it's a static-HTML reader, not a real browser session against StreetEasy)
- Walks real pagination (`?page=2`, `?page=3`, ...) on the search results rather than a fixed number of pages
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
   BRIGHTDATA_API_KEY=...
   BRIGHTDATA_ZONE=...
   ```
   The Google key needs the **Geocoding API** and **Directions API** enabled (and allowed on the key's own restriction list, not just the project). The Anthropic key needs a positive credit balance. The Bright Data key/zone come from a [Web Unlocker](https://brightdata.com/products/web-unlocker) zone in your Bright Data account — this is what actually gets past StreetEasy's bot detection; billed per successful request.
3. Paste your saved-search URL(s) into [config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>) and set `enabled: true`

`monitor/bootstrap-session.cjs` and the persistent Chrome profile at `monitor/.browser-profile/` predate the Bright Data integration. They're no longer load-bearing for bot detection — Bright Data is what StreetEasy actually sees now, not this local browser — but are left in place since a real browser profile is still what renders the fetched HTML locally.

## Running Unattended

`monitor/scheduled-scan.sh` runs the scanner, detects a systemically broken run (every new listing missing both rent and address — the signature of an expired/blocked session, not real data) and skips publishing it with a desktop notification instead of committing garbage, otherwise commits and pushes `monitor-output/` automatically.

It's installed as a macOS LaunchAgent (`~/Library/LaunchAgents`, not tracked in this repo since it's machine-specific) running twice daily. To install it yourself on another machine:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.yourname.future-elmos-world-scan.plist
```

Logs land in `monitor/scheduled-scan.log` and `monitor/launchd.log`/`launchd.err.log`.

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
