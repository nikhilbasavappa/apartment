# Background Monitor

The engine behind the web app. The person-facing entry point is still [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>); the scanner writes data files the main page loads.

## What It Does

- Reads public saved-search URLs from [config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>)
- Visits listing pages with Playwright plus your installed Chrome
- Pulls title, rent, beds, baths, text signals, photos, and a page screenshot
- Scores each apartment against your constraints
- Writes a photo-heavy report to [latest-report.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.html>) and the app feed payload to [latest-report.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.js>)
- Optionally pushes the feed to a backend you deploy via [sync-report.cjs](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/sync-report.cjs>)
- Sends a macOS notification when strong matches appear

## One-Time Setup

1. Paste saved-search URLs into [config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>)
2. Set the matching entries to `"enabled": true`

These should be public search-result URLs you can open in a browser without extra clicks.

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
- [state.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/state.json>)

## Optional Backend Sync

Copy [monitor/.sync.example.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/.sync.example.json>) to `monitor/.sync.json` and fill in your backend's report endpoint and sync token. That file is gitignored so the token stays local. Not required — the static GitHub Pages deployment works without it.

## Current Limitation

Kitchen judgment is heuristic-first: listing text is screened for `open kitchen`, `galley`, `island kitchen`, `windowed kitchen`, and similar phrases. The report includes screenshots and listing photos so you can inspect the shortlist without opening every listing.
