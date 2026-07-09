# Background Scanner

The engine behind the web app. The person-facing entry point is still [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>); the scanner writes data files the main page loads.

## What It Does

- Reads public saved-search URLs from [config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>)
- Visits listing pages with Playwright plus your installed Chrome, reusing a real persistent browser profile (see below) to get past StreetEasy's bot check
- Paces itself like a person, not a script — randomized delays between listings, occasional longer pauses, scrolls the search page until it genuinely stops loading more rather than a fixed number of steps
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
4. Bootstrap a trusted browser profile once:
   ```bash
   node monitor/bootstrap-session.cjs
   ```
   A real Chrome window opens to your search. Solve the "Press & Hold" human-check yourself, then browse for a bit like a normal visitor — click into a couple listings, scroll, take your time — before pressing Enter in the terminal. This builds a real persistent Chrome profile at `monitor/.browser-profile/` (gitignored: cookies, cache, history, local storage — everything, not just a cookie export), which every future automated scan reuses as-is. Redo this whenever scans start coming back broken (you'll get a desktop notification if you're on the scheduled job — see below).

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
