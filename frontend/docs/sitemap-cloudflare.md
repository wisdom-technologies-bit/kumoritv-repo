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
