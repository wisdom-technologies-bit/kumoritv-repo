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
