# Cloudflare cache rule for the sitemaps

The origin sets `Cache-Control: public, max-age=300, s-maxage=3600,
stale-while-revalidate=86400` on every sitemap response, but **Cloudflare does not
cache `.xml` by default**: the live responses carry `cf-cache-status: DYNAMIC`, so
every Googlebot request re-runs the origin. In production that meant ten or more
database queries and 1.4 s to 13.7 s of response time per crawl, and an unhandled
500 whenever a slow one timed out.

This is a Cloudflare dashboard change (there is nothing to deploy). Until it is
done, the in-process cache in `lib/sitemap-cache.ts` still means the origin does
the walk once per hour per file rather than once per crawl, so this step is
about protecting the origin from many crawlers at once, not about hiding a bug.

## Create the rule

Cloudflare dashboard → the `kumoritv.top` zone → **Caching → Cache Rules → Create
rule**.

**Rule name:** `Sitemaps: cache everything for 1 hour`

**When incoming requests match** (Match editor):

```
(ends_with(http.request.uri.path, "/sitemap.xml"))
or (ends_with(http.request.uri.path, "/sitemap.xsl"))
or (starts_with(http.request.uri.path, "/sitemaps/"))
```

`starts_with(... "/sitemaps/")` covers `static.xml`, `new.xml`, `anime-N.xml` and
`episodes-N.xml`; the two `ends_with` clauses cover the index and the stylesheet
the XML points at.

**Then:**

| Setting | Value |
| --- | --- |
| Cache eligibility | **Eligible for cache** |
| Edge TTL | **Override origin** → 1 hour |
| Browser TTL | **Respect origin** (the origin sends `max-age=300`) |
| Cache key | default (query string ignored is fine; these URLs have none) |

Save and make sure the rule is above any "Bypass cache" rule that might also
match `/sitemaps/`.

## Why "Cache Everything" is right here

* The files are pure XML generated from the database and already serve a stable
  `ETag` and `Last-Modified`, so a 304 costs the origin nothing.
* `s-maxage=3600` alone is ignored by Cloudflare for `.xml`; the Cache Rule is
  what makes the edge honour it.
* Cloudflare still revalidates in the background (`stale-while-revalidate`), and
  the origin answers in 4–9 ms from its own cache, so a stale window costs one
  request, not a crawl.

## Verify it worked

```bash
curl -sI -A 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  https://kumoritv.top/sitemaps/episodes-1.xml | grep -iE 'cf-cache-status|cache-control|age'
```

* First request after the rule: `cf-cache-status: MISS` (then `DYNAMIC` must be
  gone).
* Subsequent requests: `HIT` with a growing `age`.
* A poisoned or wrong file: purge with
  **Caching → Configuration → Purge Cache → Custom Purge** by URL
  (`https://kumoritv.top/sitemap.xml` and `/sitemaps/...`), or purge the
  `sitemap` tag if you switch to cache tags.

## What is deliberately *not* done

* No bypass rule, no "development mode", no `?nocache` query trick: nothing in
  this change routes around Cloudflare.
* No Vercel-specific caching: the host is Railway (a long-running Node process),
  so caching lives in `unstable_cache`, in the process-local map in
  `lib/sitemap-cache.ts`, and now at the edge.
* The refresh cron (`app/api/cron/sitemap-refresh`) re-warms the files every 30
  minutes from inside the origin. It does not attempt to purge Cloudflare; with
  a 1 hour edge TTL a purge is unnecessary.

## Part D - why `episodes-14.xml` was frozen at 8,487 URLs

`public.sitemap_episodes_ranked` is a MATERIALIZED view: it only changes when
`refresh_sitemap_episodes()` runs. 13 x 10,000 + 8,487 = **138,487** rows, i.e.
`max(rn)` on that view, so the XML files were valid, complete and simply out of
date. Three things hid it:

1. `/api/cron/sitemap-refresh` logged `refreshError` inside a **successful** run,
   so `cron_runs.ok` stayed true and no alert ever fired. It now throws, which
   records the run as failed with the reason.
2. Nothing compared the view with the live catalogue. `/api/cron/sitemap-check`
   and `/api/cron/status` now return
   `{viewRows, liveRows, lastRefreshAt, ageMinutes, stale}` and `stale` is true
   when the counts differ by more than 1% or the last refresh is older than 90
   minutes.
3. `REFRESH MATERIALIZED VIEW CONCURRENTLY` cannot run inside a transaction
   block, which is what PostgREST gives a function, so every call fell into the
   plain-REFRESH fallback and could hit the 15 s lock timeout while sitemap
   readers held the view. The new function raises that to 30 s, records every
   attempt in `sitemap_refresh_log`, and reports `mode` (`concurrent` / `full`).

### What to run, in order

1. Supabase SQL editor: `docs/sql/sitemap-refresh-fix.sql` sections 0, 1, 2.
2. Deploy the app (the route change and the health object).
3. Same file, section 3 (one manual refresh), then section 4 (verify).

### cron-job.org entry

* Title: `KumoriTV sitemap refresh`
* URL: `https://kumoritv.top/api/cron/sitemap-refresh?wait=1`
* Schedule: every 30 minutes
* Request method: GET
* **Header:** `x-cron-secret: <CRON_SECRET>` (the value from Railway)
* Enable "Save responses" and treat a non-200 as failure - a failed refresh now
  returns 500 on purpose.

### Verify from Termux

```
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://kumoritv.top/api/cron/sitemap-refresh?wait=1" | jq
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://kumoritv.top/api/cron/sitemap-check" | jq '.health'
curl -s https://kumoritv.top/sitemaps/episodes-14.xml | grep -o "<loc>" | wc -l
```

A new chunk appears automatically: the index asks the database how many rows it
has and emits `episodes-N.xml` for `ceil(rows / 10000)` files, so a catalogue
that crosses 140,000 rows adds `episodes-15.xml` with no code change.
