# Watch resolver API

`GET /api/watch/:anilistId/:episode` resolves a playable stream from the imported episode providers. Query parameters: `audio=sub|dub` (default `sub`), `sublang=en`, `exclude=provider[:server],...`, `refresh=1`, and `debug=1`.

Success returns `anilistId`, `episode`, `audio`, selected `provider`, `server`, `type`, signed proxy `url` (or `null` plus raw `embedUrl` for embeds), normalized subtitle tracks, `intro`, `outro`, `availableAudio`, `alternatives`, and `resolvedAt`. Debug additionally includes resolver `trace` and the upstream winner URL. HLS/MP4/subtitle upstream URLs are signed and are not exposed in normal responses.

Errors: `400 invalid_episode` or `invalid_audio`; `404 episode_not_found` or `no_providers`; `429 rate_limited`; `500 database_unavailable` or `proxy_not_configured`; `502 no_playable_stream` with `tried` provider reasons.

Tunable constants: `PROVIDER_PRIORITY` controls provider order and `HARDSUB_PROVIDERS` identifies providers allowed to resolve subtitle audio without soft subtitle tracks. Proxy tokens use `PROXY_SIGNING_SECRET`; production values are supplied by Vercel.

The resolver records `resolved_provider`/`needs_resync` writes through `runInBackground`, so the response never waits on them on Render or Railway (see [background.md](./background.md)).
