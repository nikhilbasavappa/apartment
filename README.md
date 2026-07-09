# Apartment

Apartment-search web app plus a background scanner.

Buildless front end:

- plain `index.html`, `styles.css`, `app.js`
- no frontend framework, no build step
- PWA shell via `manifest.json`, `sw.js`, `icon.svg`, `.nojekyll`

The one page to open is [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>). Two layers behind it:

- a manual ranking/scoring app in [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>)
- a recurring live-listing monitor in [monitor/README.md](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/README.md>), whose output loads into the main page via [monitor-output/latest-report.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.js>)

Tuned to one profile:

- Office `53rd & Lexington`
- Start date `2026-10-13`
- Base salary `245k`, target bonus `15%`, signing bonus `130k`
- Budget `6.5k`, stretch `7k`
- Must-have `in-unit washer/dryer`, `open kitchen`
- Prefer `gas stove`
- Minimum `1BR`, ideal `2BR`

## Open It

Open [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>) directly, or serve it locally:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## What It Does

- Ranks neighborhoods by commute, friend access, apartment fit, budget fit, 2BR potential
- Scores real listings you enter
- Flags no in-unit laundry, galley kitchens, studios, above-stretch rent as pass signals
- Saves to `localStorage`, supports JSON export/import
- Loads the latest background scan results into the main page

## App Shell

- [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>)
- [styles.css](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/styles.css>)
- [app.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/app.js>)
- [manifest.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/manifest.json>)
- [icon.svg](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/icon.svg>)
- [sw.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/sw.js>)
- [.nojekyll](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/.nojekyll>)

[publish.sh](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/publish.sh>) bumps the service-worker cache version before pushing, so GitHub Pages users don't get stale JS/CSS.

## Background Monitor

For "find apartments while I'm away," use the monitor instead of the manual scorer:

- Configure live search URLs in [monitor/config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>)
- Run `./monitor/run-scan.sh` for a single pass, or `./monitor/watch-loop.sh 30` to rescan every 30 minutes
- Review results in [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>), or directly in [monitor-output/latest-report.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.html>)

Optional: if you deploy your own backend (e.g. a Cloudflare Worker), the app will fetch a live report from `/api/report` when available, and `monitor/sync-report.cjs` can push each scan there — see [monitor/README.md](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/README.md>). Neither is required; the static GitHub Pages deployment works on its own.

## Publish Loop

1. `git init`
2. Create the GitHub repo
3. Enable Pages from `main` and `/`
4. Run `./publish.sh`
5. Commit and push

Every push to `main` republishes the app.

## Notes

- Neighborhood rankings are curated heuristics, not live market data.
- Commute numbers are approximate to Midtown East.
- The monitor uses public search URLs plus browser automation; no external API required.
