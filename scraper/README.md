# Scraper service

Standalone Node service for pulling Hillsborough County court data. Two pipelines:

1. **Public-data files (no Playwright, no CAPTCHA)** — the primary backbone.
   Pulls CSVs and PDFs directly from the Clerk's `publicrec` server.
2. **HOVER via Playwright** — experimental. Still blocked by CAPTCHA on the
   search page. Keep around as a fallback for same-day document retrieval
   once we solve the auth story.

## Local setup

```
cd scraper
npm install
```

## Public-data pipelines

### Daily citations

```
node cli.mjs --citations --date 2026-04-17
node cli.mjs --citations --date 2026-04-17 --dui
node cli.mjs --citations --date 2026-04-17 --last SMITH
node cli.mjs --citations --last SMITH
```

One `Citation_DDS_YYYYMMDD.csv` is uploaded each morning (~1:30 AM) with the
previous day's citations. Every DUI (statute `316.193*`), reckless-driving,
and serious-traffic charge filed in Hillsborough lives here. 41 columns:
defendant name, DOB, address, DL, charging agency, statute, disposition,
judge. Set `--dui` to filter to DUI only; `--serious` adds reckless driving
and leaving-the-scene-with-injury. Combine with `--last` for targeted lookup.
If `--date` is omitted, the scraper automatically uses the most recent
available daily file.

### Criminal court calendars

```
node cli.mjs --calendars --type felony --date 2026-04-21
node cli.mjs --calendars --type misd --date 2026-04-21
node cli.mjs --calendars --type traffic --date 2026-04-21
node cli.mjs --calendars --type felony --date 2026-04-21 --last SMITH
```

Calendar PDFs are posted **~5 days before each court date** (add-ons 1 day
before). Each PDF covers one session (one judge, one slot) and is parsed
into case-level records: case number, defendant name/DOB/address, in-custody
flag, charges, defense + state attorneys, judge, courtroom, and the
defendant's full list of future hearings.

Use `--last` for a client-roster sweep ("show me every hearing my clients
have this week across all divisions").

## HOVER lookup (experimental)

Still blocked by the CAPTCHA on the search page. Captured in `lib/hover.mjs`
for when we either solve auth or switch to a different approach.

```
node cli.mjs --case 24-CA-012345
node cli.mjs --case 24-CA-012345 --headed
node cli.mjs --party --last Smith --first John --from 2026-01-15 --to 2026-04-15
```

## Output

All modes emit JSON on stdout. Exit code `0` on success, `2` on failure.

## When it fails

HOVER runs dump a screenshot + full HTML to `scraper/debug/`. Public-data
pipelines fail loudly with HTTP status codes — no scraping means no
screenshot needed.

## Deployment (later)

Planned target: Fly.io micro-VM with scale-to-zero (~$3–10/mo). The
public-data pipeline runs on cheap scheduled CPU; no browser needed for
99% of the job. Validate locally first.
