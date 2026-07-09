# Background Monitor

This is the background engine behind the web app.

The person-facing entry point is still [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>). The scanner writes data files that the main page can load.

## What it does

- Reads public saved-search URLs from [config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>)
- Visits new listing pages with Playwright plus your installed Chrome
- Pulls title, rent, beds, baths, text signals, photos, and a page screenshot
- Scores each apartment against your actual constraints
- Writes a photo-heavy report to [latest-report.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.html>)
- Writes the app feed payload to [latest-report.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.js>)
- Sends a macOS notification when new strong matches appear

## One-time setup

1. Paste saved-search URLs into [config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>)
2. Set the matching entries to `"enabled": true`

These should be public search-result URLs you can open in a browser without extra clicks.

## Run once

```bash
./monitor/run-scan.sh
```

## Keep it running

```bash
./monitor/watch-loop.sh 30
```

That reruns the scan every `30` minutes. Change the number if you want a different interval.

## Output files

- [latest-report.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.html>)
- [latest-summary.md](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-summary.md>)
- [state.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/state.json>)

## Current limitation

The kitchen judgment is heuristic-first right now:

- Listing text is screened for `open kitchen`, `galley`, `island kitchen`, `windowed kitchen`, and similar phrases
- The generated report also includes screenshots and listing photos so you can inspect the shortlist without opening every listing

If you want, the next step can be adding a recurring Codex automation that reviews the newest screenshots and flags kitchens that still look bad despite decent text.
