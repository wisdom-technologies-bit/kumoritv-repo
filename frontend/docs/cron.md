# Cron jobs

All routes require `Authorization: Bearer $CRON_SECRET` or `x-cron-secret`. Missing configuration returns 503; invalid credentials return 401. GET requests return 202 immediately unless `wait=1`, which runs inline and returns stats. The 202 path runs through `runInBackground`, so a redeploy drains it on shutdown (see [background.md](./background.md)).

- `/api/cron/import-queue?batch=8&wait=1`: claims import queue rows, imports with snapshots, updates queue status, and chains while work remains.
- `/api/cron/sync?batch=30&wait=1`: claims pending episode checks, imports each anime once, and retries unavailable episodes.
- `/api/cron/resync?batch=30&wait=1`: refreshes priority resync candidates and clears resolver state.
- `/api/cron/health`: always inline; returns table counts and recent cron runs.

Examples:
```sh
curl -H "Authorization: Bearer $CRON_SECRET" "$URL/api/cron/import-queue?wait=1"
curl -H "x-cron-secret: $CRON_SECRET" "$URL/api/cron/sync?batch=30"
curl -H "Authorization: Bearer $CRON_SECRET" "$URL/api/cron/resync?wait=1"
curl -H "Authorization: Bearer $CRON_SECRET" "$URL/api/cron/health"
```
- `/api/cron/logos?batch=40&wait=1`: fills `anime.logo_path`, `logo_aspect_ratio`, `logo_width` from TMDB for titles that already have a TMDB id in `anime.mappings`. Never calls Anivexa. Stats: `{ claimed, found, none, errors, skipped, rateLimited, remaining }`.

## Title logos (`/api/cron/logos`)

Optional. Title logos are the transparent PNG wordmarks some streaming sites show
instead of the plain text title. They are stored in our own database
(`logo_path` + aspect ratio + width) so the media page never calls TMDB or
Anivexa while rendering.

- Requires `TMDB_API_KEY` (v3) **or** `TMDB_READ_ACCESS_TOKEN` (v4). Set it in the
  Railway/Render dashboard (and locally in `.env.local`). Without it the job
  reports `disabled`, nothing is fetched, and the site shows text titles.
- Rows are picked in this order: never checked, then `logo_status = 'error'`
  older than 1 hour, then `logo_status = 'none'` older than 30 days (TMDB may
  have added a logo since). Popular titles first (`score desc`). Rows that
  already have a logo are left alone unless `force=1`.
- Rows with no TMDB id in `mappings` are stamped `none` without a TMDB call; the
  resync job refreshes `mappings` and the daily recheck picks them up.
- Each row is claimed atomically before the HTTP call, so overlapping runs never
  process the same row. A 429 stops the batch, releases the claimed row and
  returns `retryAfterMs`.
- The media page also fills lazily: the first visit renders the text title and
  the fetch happens after the response (`runInBackground`), so the next visit
  shows the logo.

cron-job.org schedule: every 10 minutes while `remaining` is greater than 0,
then once a day.

```sh
curl -H "Authorization: Bearer $CRON_SECRET" "https://kumoritv.top/api/cron/logos?batch=40"
```
