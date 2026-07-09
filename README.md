# Lex & Laundry

Buildless apartment-search web app and background scanner.

The app is designed to be served directly by GitHub Pages:

- no bundler
- no frontend build step
- plain `index.html`, `styles.css`, `app.js`
- PWA shell via `manifest.json`, `sw.js`, `icon.svg`, and `.nojekyll`

The one page a person should open is [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>).

This project still has two technical layers behind that one page:

- a manual ranking/scoring app in [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>)
- a recurring live-listing monitor in [monitor/README.md](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/README.md>) whose output is surfaced back inside the main page through [monitor-output/latest-report.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.js>)

Both are tuned to one specific profile:

- Office at `53rd & Lexington`
- Start date `2026-10-13`
- Base salary `245k`
- Target bonus `15%`
- Signing bonus `130k`
- Budget `6.5k`, stretch `7k`
- Must-have `in-unit washer/dryer`
- Must-have `open kitchen`
- Prefer `gas stove`
- Minimum `1BR`, ideal `2BR`

## Open It

Simplest option:

1. Open [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>)

If you want a local server instead:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## What It Does

- Ranks target neighborhoods based on commute, friend access, apartment-fit odds, budget fit, and 2BR potential
- Lets you enter real listings and score them
- Treats no in-unit laundry, galley kitchens, studios, and above-stretch rents as strong pass signals
- Saves your work to `localStorage`
- Supports JSON export/import
- Loads the latest background scan results directly into the main page so the app can behave like one front door

## GitHub Pages Shape

Static app shell files:

- [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>)
- [styles.css](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/styles.css>)
- [app.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/app.js>)
- [manifest.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/manifest.json>)
- [icon.svg](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/icon.svg>)
- [sw.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/sw.js>)
- [.nojekyll](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/.nojekyll>)

Deploy helper:

- [publish.sh](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/publish.sh>)
- [bump-sw-cache.cjs](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/bump-sw-cache.cjs>)

`publish.sh` exists for one reason: bump the service-worker cache version before pushing so GitHub Pages users do not get stale JS/CSS.

## Background Monitor

If the real problem is "find apartments while I am away," use the monitor instead of the manual scorer:

- Configure live search URLs in [monitor/config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>)
- Run `./monitor/run-scan.sh` for a single pass
- Run `./monitor/watch-loop.sh 30` to rescan every 30 minutes
- Review the results directly in [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>) or, secondarily, in [monitor-output/latest-report.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor-output/latest-report.html>)

## Repo And Publish Loop

Suggested flow:

1. `git init`
2. Create the GitHub repo
3. Enable Pages from `main` and `/`
4. Run `./publish.sh`
5. Commit and push

Once GitHub Pages is enabled, every push to `main` republishes the app shell.

## Notes

- Neighborhood rankings are curated heuristics, not live listing data.
- Commute numbers are approximate to Midtown East.
- The recurring monitor uses public search URLs plus browser automation and does not require an external API.
