# Apartment

Automated apartment search. A background scanner finds listings on StreetEasy that clear every hard requirement — budget, bedrooms, in-unit washer/dryer, open kitchen confirmed from photos — and calculates real commute times. The web app just shows what qualified. No manual entry, no scores to tune.

Buildless front end:

- plain `index.html`, `styles.css`, `app.js`
- no frontend framework, no build step
- PWA shell via `manifest.json`, `sw.js`, `icon.svg`, `.nojekyll`

The one page to open is [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>). It renders whatever [monitor/](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/README.md>) — the background scanner — found on its last run.

Fixed criteria (in [monitor/config.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/config.json>), not a UI):

- Office `Lexington Ave & E 53rd St`
- Start date `2026-10-13`
- Budget `$3,500-7,000`
- Must-have `in-unit washer/dryer`, `open or semi-open kitchen` (confirmed from listing photos)
- Minimum `1BR`
- Commute calculated to office, Prospect Heights, Long Island City, and Morningside Heights

## Open It

Open [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>) directly, or serve it locally:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## What It Does

- Scans your configured StreetEasy saved search(es)
- For each new listing: extracts address, price, beds/baths; geocodes the address; gets real transit commute times + subway lines to 4 destinations via Google Directions; has Claude look at the listing photos to judge kitchen layout and stove type
- Excludes anything that doesn't clear every hard requirement — no partial credit, no composite score
- Publishes the qualifying shortlist into this page automatically

## App Shell

- [index.html](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/index.html>)
- [styles.css](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/styles.css>)
- [app.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/app.js>)
- [manifest.json](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/manifest.json>)
- [icon.svg](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/icon.svg>)
- [sw.js](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/sw.js>)
- [.nojekyll](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/.nojekyll>)

[publish.sh](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/publish.sh>) bumps the service-worker cache version before pushing, so GitHub Pages users don't get stale JS/CSS.

## Background Scanner

See [monitor/README.md](</Users/nikhilbasavappa/CBS Dropbox/Nikhil Basavappa/Personal Files/Home/Apartment/monitor/README.md>) for setup (API keys, one-time session bootstrap, running it).

## Publish Loop

1. `git init`
2. Create the GitHub repo
3. Enable Pages from `main` and `/`
4. Run `./publish.sh`
5. Commit and push

Every push to `main` republishes the app.

## Notes

- Commute times are real (Google Directions, transit mode), not estimates.
- Kitchen/stove judgment comes from Claude looking at the actual listing photos, not keyword matching.
- StreetEasy blocks automated browsers with a bot challenge; the scanner reuses a session you bootstrap manually once (see monitor/README.md).
