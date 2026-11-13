# The ani provider (our own streaming API), tried before Anivexa

`ani` is KumoriTV's own stream API (`https://ani-api.kumoritv.top`, the `api/`
folder of `wisdom-technologies-bit/ani-cli`). It is asked **first**; every
Anivexa provider stays **second and unchanged**. When the provider is off, or when
it is skipped or fails for any reason, the watch route runs exactly the code it
ran before this feature existed - a regression snapshot proves it (see Tests).

Nothing here changes `has_streams`, the sitemap views, `lib/anime-db/import.ts`,
`lib/anivexa/*` or `lib/watch/order.ts`. "ani" is never written to
`episodes.resolved_provider`, `sub_providers` or `dub_providers`.

## Data flow

```
GET /api/watch/<anilistId>/<episode>?audio=sub|dub
  │
  ├─ load the episode row (unchanged; importAnime if missing)
  ├─ aniGate()                       ← flag, key, bucket, audio, provider=, exclude=
  │    └─ lookupMalId(anime.mal_id)   ← one small query, only when the gate passes
  ├─ resolveAni()
  │    ├─ client.getAniStream()       ← cache → single flight → breaker → limiter → fetch
  │    ├─ validateAniStream()         ← verified MAL id + episode, hls, https CDN host, playable variant
  │    ├─ buildAniWinner()            ← one "Kumori" server button, raw master_url, subtitles
  │    └─ probeStream()               ← our own probe of the first segment
  │
  ├─ winner set → skip the Anivexa loop entirely
  └─ otherwise → the existing Anivexa loop, line for line
       │
       └─ both paths share everything downstream:
          proxyUrl("manifest" | "subtitle"), server buttons, response
```

The response shape is identical: `{provider, server, serverId, hasBackup, type,
url, subtitles, thumbnails, intro, outro, availableAudio, servers, resolvedAt}`.

`hasBackup` is true when ani wins **and** the episode has an Anivexa provider for
that audio, so "Try another server" and the automatic fallback still work.
`availableAudio` keeps coming from the DB columns: ani never adds dub by itself.

## Configuration

Every value is read **per request**, not at build time. Changing a Railway
variable and restarting the service is enough; no redeploy of the image needed.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANI_API_BASE_URL` | _(unset)_ | Base URL, e.g. `https://ani-api.kumoritv.top`. Unset = provider off. |
| `ANI_API_KEY` | _(unset)_ | Sent as `X-API-Key`. Server only. Unset = provider off. |
| `ANI_PROVIDER_ENABLED` | off | Only the literal `1` enables it. |
| `ANI_PROVIDER_PERCENT` | `100` | 0-100. Stable FNV-1a hash of the anilist id, so the same anime always lands in the same bucket. |
| `ANI_DUB_ENABLED` | off | The API only *declares* dub; leave off until verified by ear. |
| `ANI_API_TIMEOUT_MS` | `15000` | Per attempt. |
| `ANI_MAX_CONCURRENCY` | `4` | In-flight requests per process. |
| `ANI_RATE_PER_MIN` | `40` | Token bucket, capped at 55 - the API allows 60/key. |
| `DIRECT_SEGMENT_HOSTS` | `hls1.drama1.cfd` | Optional. Segment hosts left absolute in a manifest. `none` disables. |

## Failure and fallback rules

The provider falls through to Anivexa (the old path, unchanged) on:

| Situation | Reason code |
| --- | --- |
| feature flag off / key or base URL missing | `disabled`, `not_configured` |
| anime outside the rollout bucket | `percent_out` |
| a different provider was requested | `provider_pinned` |
| `exclude=ani` | `excluded` |
| dub and `ANI_DUB_ENABLED` off | `audio_unsupported` |
| the anime has no `mal_id` | `no_mal_id` |
| 5 failures in 60 s | `breaker_open` |
| a 429 from the API | `paused`, `rate_limited` |
| our own limiter is full | `saturated` (viewers are never queued) |
| key rejected | `auth` |
| timeout / network | `timeout`, `network_error` |
| 5xx | `upstream_error` |
| `MAL_NOT_FOUND`, `MAL_NOT_MAPPED`, `MAL_MAPPING_AMBIGUOUS`, `MAL_EPISODE_NOT_FOUND` | `mal_not_found`, `mal_not_mapped`, `mal_ambiguous`, `mal_episode_not_found` |
| `MAL_EPISODE_MISMATCH` | `mal_episode_mismatch` |
| `MAL_TITLE_SOURCE_*` | `mal_title_source` |
| `stream_verified` is not `true` | `unverified_stream` |
| the response names a different MAL id or episode | `stream_mismatch` |
| not HLS, no playable variant, master host not a known CDN | `not_hls`, `no_playable_variant`, `master_host_not_allowed` |
| our probe of the first segment failed | `probe_failed` |

`provider=ani` is explicit mode: if the provider cannot serve, the answer is
`502 {error:"no_playable_stream", provider:"ani", tried:[{provider:"ani",reason}]}`
and Anivexa is **not** tried.

With `?debug=1` the response carries `trace`, one entry per provider:
`{provider:"ani", outcome:"success"|"failed"|"skipped", reason?, ms}`.

## Caching

| What | Lifetime | Why |
| --- | --- | --- |
| ani stream, in memory | 10 min | The upstream URLs were observed valid ~28 min; never cache past 15. |
| MAL_* "no mapping" answers | 30 min | A title that cannot be mapped will not map in a minute. |
| 409 / 5xx | 60 s | Transient by nature. |
| auth, 429, timeout, breaker | not cached | These describe the provider, not the title. |
| watch route response | 5 min (Anivexa), 10 min (ani) | `refresh=1` bypasses both. |
| cache size | 500 entries, LRU | Bounded memory. |

## Security

* `ANI_API_KEY` is read in `app/lib/ani/config.ts` and used as one request header.
  It is never cached, logged, returned, or signed into a token.
* Every module in `app/lib/ani/` is `import "server-only"` except `constants.ts`,
  which holds two plain strings the client player needs and no environment access.
* No `NEXT_PUBLIC_*` variant exists. A test fails the build if one appears.
* The browser only ever sees `master_url` (the raw CDN URL) behind our own signed
  proxy token, exactly like Anivexa. The ani-api URL and key are never in front of
  a viewer.
* Log lines contain a reason code, the anilist id, the episode and a duration and
  nothing else.
* Upstream hosts are allow-listed (`dramahot.top`, `drama1.cfd` and subdomains)
  **and** passed through the app's existing `assertSafeUpstream`.

## Segments

`/api/proxy/manifest` rewrites playlists, key playlists, `EXT-X-MAP` and subtitle
playlists to our own URLs - that is unchanged. Media segments are the one
exception: a segment on a host in `DIRECT_SEGMENT_HOSTS` is left **absolute**, so
it loads straight from the CDN instead of through Railway. Only
`hls1.drama1.cfd` is listed by default; it is CORS-open (`*`), needs no Referer
and serves `video/mp2t` under `*.ts.jpg` names. Every other host, Anivexa's
included, is still proxied exactly as before. Set `DIRECT_SEGMENT_HOSTS=none` to
proxy everything again.

## Subtitles

Every track the API returns is offered, with the provider's label verbatim
("English", "Arabic", "Portuguese - Brazil"). Order: the provider's default, then
the viewer's `sublang`, then English, then the rest. Tracks with
`playable:false` (thumbnails, sprites) and unknown kinds are skipped. `lang` is
the API's own language code, `und` when it names none. Nothing is marked verified:
the API itself reports `language_verified:false` on every track.

SRT/ASS tracks work through the existing subtitle proxy, which already converts
to WebVTT (`lib/proxy/vtt-validate.ts`), so no new proxy route was needed. The
browser never receives a subtitle URL from the ani-api.

## Deploying (owner steps)

1. Railway → KumoriTV service → Variables:

   ```
   ANI_API_BASE_URL=https://ani-api.kumoritv.top
   ANI_API_KEY=<your key>
   ANI_PROVIDER_ENABLED=0
   ANI_PROVIDER_PERCENT=100
   ANI_DUB_ENABLED=0
   ```

   Redeploy so the variables exist. With `ANI_PROVIDER_ENABLED=0` nothing calls
   the API; the response is byte-identical to today's.
2. Test one episode with `ANI_PROVIDER_ENABLED=1` and
   `/api/watch/<anilistId>/<episode>?debug=1` (see below), then set the flag back
   to `0`.
3. Roll out gradually: `ANI_PROVIDER_ENABLED=1`, `ANI_PROVIDER_PERCENT=10`, watch
   `/api/admin/ani-status` for an hour, then 25, 50, 100. Raising the percentage
   only ever adds anime, never reshuffles them.
4. Leave `ANI_DUB_ENABLED=0` until you have listened to a dub episode and are
   satisfied the audio really is the dub.

### Disable instantly

Set `ANI_PROVIDER_ENABLED=0` and restart. In-flight requests finish; new ones go
straight to Anivexa. Nothing else to undo - no data was written.

### Rotate the key

The API accepts several keys. Add the new one to its key list, set
`ANI_API_KEY=<new>` on Railway, restart, confirm `ok` outcomes in
`/api/admin/ani-status`, then remove the old key from the API. A bad key produces
`reason=auth` and the breaker opens after five failures, so a mistake costs at
most a few skipped requests per minute.

## What to watch in `/api/admin/ani-status`

Owner-only: `x-cron-secret: $CRON_SECRET` (the app's only admin auth), or
`Authorization: Bearer $CRON_SECRET`.

```
curl -H "x-cron-secret: $CRON_SECRET" https://kumoritv.top/api/admin/ani-status
```

It returns `enabled`, `configured`, the upstream `host`, `percent`,
`dubEnabled`, the breaker (`open`, `opensAt`, `recentFailures`), the 429 `paused`
state, cache `entries`, the limiter budget, `counters`
(`ok`, `skipped:<reason>`, `failed:<reason>`, `fallback_to_anivexa`) and the last
20 outcomes newest first. No key, no URLs, no upstream bodies.

Reading it: a healthy rollout is mostly `ok`, with `skipped:no_mal_id` and
`failed:mal_not_mapped` for titles the API cannot map (expected), and few
`fallback_to_anivexa`. A jump in `failed:auth` means the key is wrong; a jump in
`failed:upstream_error` with `breaker.open` means the API is down.

### Test one episode

```
curl 'https://kumoritv.top/api/watch/21/1?audio=sub&debug=1' | jq '.provider, .trace'
```

`provider:"ani"` with `trace[0].outcome:"success"` means it worked. Compare with
`?provider=ani` (explicit mode) and `?exclude=ani` (Anivexa only).

## Known limits

* **No downloads.** The API does not support direct downloads (`download.available`
  is false), so KumoriTV does not offer any either.
* **Dropped connections.** Upstream stream URLs were observed valid for about 28
  minutes. The player therefore re-requests the watch API once with `refresh=1`
  (keeping the viewer's position) before it excludes ani and falls back to
  Anivexa.
* **Dub is unverified.** `audio.verified` is always false upstream; hence the flag.
* **Language labels are the provider's.** Two tracks labelled "English" can differ;
  the API cannot prove otherwise.

## Tests

```
npm test                                        # whole suite
node --test … app/lib/ani/__tests__/*.test.ts   # the provider's own tests
```

* `config.test.ts` - defaults, clamping, bucket stability, rollout monotonicity.
* `client.test.ts` - validation rules, positive/negative cache, single flight,
  breaker, 429 pause, limiter, one retry only on 502/503/504.
* `subtitles.test.ts` - every track selectable, ordering, `und`, defaults.
* `route.test.ts` - ani first; every failure falls through to Anivexa; explicit
  mode; `exclude=ani`; `refresh=1`; dub gate on/off; rollout bucket; the flag-off
  response compared with a snapshot captured from `master`
  (`fixtures/watch-anivexa-only.snapshot.json`); an episode with no Anivexa
  providers at all.
* `key-leak.test.ts` - the key never reaches `.next/static`, a server chunk, a
  response body or a signed token; no `NEXT_PUBLIC_ANI`; only `config.ts` reads
  the key.
* `scripts/ani-live-check.mjs` - the live smoke script (needs a key).
