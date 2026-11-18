# Clips: the public browse (Phase 5)

Before Phase 5, `/clips` was **My clips** only: private, `noindex`, signed-in.
Phase 5 adds a public browse over live clips on the same route, behind a flag, so
the page can be turned on after the owner has looked at it.

Everything below is what the code does, not what it should do.

## Turning it on

Set `CLIPS_PUBLIC_ENABLED` on the deployment to any of `1`, `true`, `yes`, `on`.

It is read **per request**, not inlined at build time, so changing the variable
on Railway changes the site without a rebuild.

With the flag **off** (the default) nothing changes from before Phase 5:

* `/clips` renders **My clips** for a signed-in viewer, the sign-in prompt for a
  guest, and stays `noindex`;
* `GET /api/clips` answers **404**, so an endpoint that lists every clip on the
  site is never advertised before it has been checked;
* `/clips` is **not** in the sitemap.

With the flag **on**: `/clips` is the public list (indexable), the signed-in
viewer gets an **All clips | My clips** tab pair, and `/clips` enters the sitemap
with `changefreq: daily`, `priority: 0.7`.

## The API

```
GET /api/clips?sort=latest|views|week&anime=<anilistId>&q=<text>&cursor=<opaque>&limit=24
```

| Parameter | Meaning |
| --- | --- |
| `sort` | `latest` (default, newest first), `views` (most viewed), `week` (created in the last seven days, then newest first). Anything else falls back to `latest`. |
| `anime` | AniList id, digits only. anything invalid is ignored, i.e. every title. |
| `q` | Search text, trimmed; matching is case-insensitive. Shorter than 2 characters is not a search, longer than 80 is cut to 80. |
| `limit` | Page size, 1 to 48; default 24. The "Load more" button uses the default. |
| `cursor` | The opaque `nextCursor` from the previous page. Decoding is versioned: a cursor with an unknown version is ignored, which starts from the first page rather than erroring. |

Response (`200`):

```json
{
  "items": [
    {
      "code": "abc23xy",
      "anilistId": 21,
      "animeTitle": "One Piece",
      "episode": 1085,
      "start": 62,
      "end": 77,
      "durationSec": 15,
      "views": 12,
      "createdAt": "2026-11-18T02:10:00.000Z",
      "authorName": "adaeze",
      "thumb": "/thumb/21/1085",
      "adult": false
    }
  ],
  "nextCursor": "eyJ2IjoxLCJzb3J0IjoibGF0ZXN0Iiwi..."
}
```

`nextCursor` is `null` when that was the last page; there is no total count (a
count over a growing table is the one thing this design avoids). The clip's own
URL is derived from `code` (`/clip/<code>`) by the client.

Headers: `cache-control: public, s-maxage=30, stale-while-revalidate=60`, a weak
`etag` over the body and `vary: accept-encoding`, so a re-poll that changes
nothing answers **304** with an empty body. Errors, all `no-store`:

* `404 {"error":"not_found"}` when `CLIPS_PUBLIC_ENABLED` is off;
* `429 {"error":"rate_limited"}` past **60 requests/minute** per IP, with
  `retry-after`;
* `503 {"error":"unavailable"}` when the database cannot be reached (a database
  outage is never cached).

### Why one cached body is safe (the adult rule)

Adult (hentai) clips are **listed**, so the list is honest about what exists, but
the shared response carries **no thumbnail, no anime title, no episode, no time
range and no author** for them. The body is byte-identical for every viewer,
which is what lets a CDN cache it. The client decides what to draw: an
"Adult content 18+" placeholder, or a muted card that opens the clip page, where
the normal adult gate applies.

Soft-deleted clips are invisible: every query filters `deleted_at is null`.

## Paging

Paging is **keyset**, not offset: the cursor holds the last row's sort key
(`created_at`, or the view count) plus its id as a tie-break. A clip created
while the reader is on page 3 can therefore never push a row onto page 4 and
duplicate it. The cursor is base64url JSON and is opaque to clients: do not
parse it, just pass `next_cursor` back.

## The page

`/clips` server-renders the first page (so a crawler and a first paint both see
cards), then a client list takes over for filters and "Load more".

* **Tabs:** All clips (public, only while the flag is on) and My clips (private,
  `noindex`, signed-in).
* **Sort:** Latest | Most viewed | This week.
* **Filters:** a title dropdown built from the clips page itself, and a search
  box (2 characters minimum, debounced).
* **Cards:** thumbnail, anime title, episode, time range, clip title, views,
  age. Adult cards are the placeholder described above.
* **My clips** keeps its behaviour exactly: the same rows, the same delete, the
  same signed-out prompt. It is re-skinned to match the new page, nothing else.

The clip page `/clip/[code]` gained one thing: a "Back to clips" link. Nothing
else about it changed.

## Env vars (all optional except where noted)

| Variable | Default | What it does |
| --- | --- | --- |
| `CLIPS_PUBLIC_ENABLED` | empty = **off** | The public browse, `GET /api/clips` and the sitemap entry. Read per request. |
| `CLIP_OWNER_SECRET` | none: guest ownership then falls back to the app secret | The HMAC key for the guest owner cookie. Changing it invalidates every existing guest's "My clips" list (their clips stay public, their browser just stops being able to delete them). |

Nothing else was added. Paging, rate limits, the cache TTL and the page size are
constants in code, not env vars: `CLIPS_BROWSE_LIMIT` 24, `CLIPS_BROWSE_MAX_LIMIT`
48, `CLIPS_PAGE_SIZE` 50 (anime titles in the dropdown), `BROWSE_RATE` 60/min,
`BROWSE_CACHE` 30 s, `CLIPS_SEARCH_MIN` 2, `CLIPS_SEARCH_MAX` 80.

## Database

**No SQL is needed for Phase 5.** The browse reads the existing `clips` table
(created in the clips phase) with the service-role client, so the row-level
security policies are unchanged and owners are still keyed as before. There is
no `docs/sql` file for this phase on purpose: running nothing is the correct run
order.

## Rollback

Unset `CLIPS_PUBLIC_ENABLED` (or set it to `0`) and redeploy. That is the whole
rollback: the API 404s, the page is My clips again, `/clips` leaves the sitemap,
and nothing in the database changes.

## Tests

```bash
cd frontend
npm test                                    # unit, handler and component
npx playwright test --config test-harness/community-e2e/playwright.config.ts \
  test-harness/community-e2e/clips.spec.ts
```

The browser suite runs the real production build against a Supabase stand-in and
covers the flag on and off, the tab pair, sort and search, "Load more", adult
cards, "My clips" preservation and the "Back to clips" link at 360, 412, 768 and
1280 wide. Screenshots land in `test-harness/community-e2e/screenshots/`.
