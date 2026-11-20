# Security audit: streams, subtitles, downloads and accounts

Research and report only. No runtime behaviour was changed in this part.

**Plain statement first:** anything a browser can play can be captured. Every
control below raises the cost, shortens the window, or tells you who is abusing
the site. None of them makes ripping impossible, and a design that claims
otherwise is theatre. The goal here is cost-to-attacker, detection, and the
ability to contain an incident in minutes.

## 1. Assets and threat model

### What is worth protecting

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| `ANI_API_KEY` | Railway env, read per call in `app/lib/ani/client.ts:286` (`x-api-key`) | The upstream quota is the scarce resource; leaking it lets someone else spend it |
| Upstream stream hosts | Encoded inside signed proxy tokens | A direct host is a free, unauthenticated API for a scraper |
| The signed proxy | `app/lib/proxy/signing.ts` | The only thing standing between a browser and the upstream host |
| Download links | `app/api/downloads/route.ts` | Highest-value target: a direct file, no player needed |
| User accounts | Supabase (`profiles`, `favourites`, `watchlist`, `watch_progress`) | Session theft, cross-user reads, data loss |
| The community | `community_*` tables, RPCs | Spam, harassment, defamation, report abuse |
| Admin/cron secrets | `CRON_SECRET` via `x-cron-secret` | A leaked cron secret can trigger jobs and read admin status |

### Attackers and what they can do today

| Attacker | Today |
| --- | --- |
| **Casual downloader** | Opens devtools, copies the signed segment URLs, or uses `yt-dlp` on the manifest. Tokens live 4 hours (`signing.ts:16`), so a copied URL keeps working for hours and is not tied to the session that obtained it |
| **Scripted scraper** | Calls `POST /api/watch/<anilistId>/<episode>` with no auth, gets a manifest URL and signed segments. The resolve endpoint has no quota and no bot check. With the site as an oracle, the upstream key is never needed |
| **API-mirror / clone site** | Points its own frontend at `kumoritv.top/api/watch/...` and proxies the bytes. CORS does not stop server-side fetches |
| **Credential stuffer** | Supabase handles auth; the app adds no lockout of its own. `/api/auth/anilist-session` is limited to 10/min per IP per instance (`app/lib/anilist/rateLimit.ts`), which is per-process only |
| **Content reporter / abuser** | Community reports and blocks exist (Phase 6); rate limits are durable (Postgres), which is the right model |

### The code as it stands (verified)

- **Resolve**: `app/api/watch/[anilistId]/[episode]/route.ts` is a `POST`, `dynamic = "force-dynamic"`, with a module-level `Map` cache (5 min, 10 min for ani answers, `:48-51`). No auth, no quota, no Turnstile, no per-session binding. It returns proxy URLs already signed.
- **Proxy**: `app/lib/proxy/signing.ts` signs `{u, h, e, f}` with HMAC-SHA256 over the base64 payload (`:20-22`). It rejects private targets (`assertPublic`, `:14`), only forwards `referer`, `origin`, `user-agent`, `accept`, `accept-language` (`:19`), and defaults to a **4-hour** expiry (`:16`). Segment/subtitle/manifest routes verify the token (`app/api/proxy/segment/route.ts:4`, `manifest/route.ts:108-112`).
- **Provider key**: never sent to the browser. `app/lib/ani/client.ts:286` adds `x-api-key` server-side; the client gate is `ANI_UPSTREAM_HOSTS` (`:34`).
- **Downloads**: `app/api/downloads/route.ts` is gated by `downloadsEnabled()` and an ad config, but the links it returns are not signed per viewer.
- **Cron/admin**: one shared secret, `x-cron-secret: $CRON_SECRET`, on every cron and admin route (e.g. `app/api/cron/sitemap-refresh/route.ts:17`, `app/api/admin/ani-status/route.ts:14`). Same secret for all jobs, no rotation, no per-job scope.
- **Build**: `next.config.mjs` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`. A type error does not block a deploy.
- **Headers**: only `Referrer-Policy` and the `/sw.js` cache rules (`next.config.mjs:27-59`). No CSP, HSTS, COOP/CORP, or Permissions-Policy.
- **Cookies**: the AniList token is httpOnly (and AES-GCM encrypted in the code flow). Preference cookies (`media_title_language`, `subtitle_language`, adult flag) are readable by JS by design; none is a credential.
- **Service role**: only `app/lib/supabase/admin.ts` builds it. Good.

### RLS and grants, table by table (the open audit)

Verified by reading every migration.

| Table | RLS | Policies | Verdict |
| --- | --- | --- | --- |
| `favourites` | **no** | none | **HIGH**: `user_id` is in the row, but nothing stops the anon key reading or writing other users' rows |
| `watchlist` | **no** | none | **HIGH**: same |
| `watch_progress` | **no** | none | **HIGH**: same, and it is the most personal (what you watched, when) |
| `profiles` | yes | own-row | ok |
| `notifications`, `notification_subscriptions` | yes | own-row | ok |
| `user_notifications`, `push_preferences`, `announcement_reads` | yes | own-row | ok |
| `push_outbox`, `staff_roles`, `provider_health` | yes | revoked from anon/authenticated | ok |
| `comments`, `comment_reactions`, `chapters_read`, `skip_times` | yes | own-row / read rules | ok |
| `community_*` | yes | Phase 6 policies | ok (audited in Phase 6) |
| `anime`, `episodes`, `anime_import_queue` | no RLS | catalogue data | acceptable: public read is intended; writes only via service role |

The three "no" rows are the finding the earlier audit left open. Fix in
`docs/sql/` as a migration:

```sql
alter table public.favourites      enable row level security;
alter table public.watchlist       enable row level security;
alter table public.watch_progress  enable row level security;

create policy "favourites own" on public.favourites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watchlist own" on public.watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watch_progress own" on public.watch_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Run it **after** confirming no server path writes those tables with the anon key
(they all go through the user's own session, so this should be a no-op for the
app and a hard stop for everyone else).

## 2. Findings, ranked by real risk

| # | Finding | Evidence | Attacker | Fix | Effort | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | `favourites`/`watchlist`/`watch_progress` have no RLS | migrations above | credential stuffer, scraper with anon key | the migration above | S | verified |
| F2 | Resolve endpoint is unauthenticated and unthrottled | `app/api/watch/[anilistId]/[episode]/route.ts` POST | scripted scraper, clone site | token + quota + challenge (phase 2/3) | M | verified |
| F3 | Proxy tokens live 4 h and are not bound to a session | `signing.ts:16` | casual downloader, scraper | 60-120 s expiry, bind to episode + session, replay cap | M | verified |
| F4 | Download links are not signed per viewer | `app/api/downloads/route.ts` | casual downloader | same signed-token scheme as the proxy | S | verified |
| F5 | No CSP / HSTS / COOP / CORP / Permissions-Policy | `next.config.mjs:27-59` | XSS impact, clickjacking, token theft | headers (phase 1) | S | verified |
| F6 | One shared `CRON_SECRET` for every job and no rotation | cron/admin routes | anyone who finds it in a log or a screenshot | per-job secrets + rotation | S | verified |
| F7 | Build ignores type and lint errors | `next.config.mjs:3-8` | ships a broken auth check silently | remove after the baseline is clean | S | verified |
| F8 | Rate limiting for the AniList routes is per-instance memory | `app/lib/anilist/rateLimit.ts` | credential stuffer across instances | Upstash/Redis or a Postgres table | M | verified |
| F9 | No bot challenge on resolve | n/a | scripted scraper | Turnstile invisible after suspicious behaviour | M | assumption: not present, needs a live test |
| F10 | Cloudflare cache rules could cache HTML with `Set-Cookie` | docs/sitemap-cloudflare.md | privacy leak (one user's page to another) | scope cache rules to assets/API only | S | assumption: rules not readable from here |

## 3. Proposed hardening design

Each control with its honest cost. "Reject" means I would not ship it.

### 3.1 Short-lived signed tokens (keep, strengthen) — **accept**

Already built (`signing.ts`). Change: expiry **60-120 s** for segments, **10 min**
for a manifest, bind the payload to `{anilistId, episode, sessionId}` and keep a
short replay window (Redis/Postgres counter per token id). HMAC is enough; an
asymmetric key buys nothing here because the verifier is the same service.

- Stops: copied URLs after a minute, cross-episode reuse, most casual ripping.
- Costs: a segment that expires mid-playback on a slow link; refresh logic must
  re-sign rather than re-resolve. Mobile networks with 3-5 s segment gaps need the
  manifest to hand out fresh tokens, not a static playlist.
- False positives: a viewer who pauses for 3 minutes then resumes needs the player
  to re-sign, not to fail. This is the main engineering risk.

### 3.2 Never expose upstream hosts or the API key — **already true, keep**

The browser sees `/api/proxy/...` only. Verify in a test that no response body
contains an upstream hostname (acceptance test below).

### 3.3 Quotas: edge + app — **accept**

Cloudflare WAF rate limiting per IP and per ASN on `/api/watch/*` and
`/api/proxy/*` (e.g. 120/min burst, 600/hour), plus an app limiter that works
across instances. Use **Upstash Redis** (one HTTP call, no connection pool on
Railway) over Supabase for latency; Supabase is the fallback if you would rather
not add a service.

- Honest limit: mobile CGNAT puts thousands of real viewers behind one IP. Per-IP
  limits must be generous and paired with per-session limits, or you will throttle
  a whole carrier. Cloudflare's free tier gives one rate-limit rule and its
  counters are per data centre, so the edge alone is not sufficient.

### 3.4 Bot challenge — **accept, narrowly**

Turnstile (invisible) **only** on the resolve endpoint, and only after the
behaviour score is already suspicious. Never on segments, never on page loads.
Cloudflare's managed challenge is free and works on mobile; a `curl` client
without a browser fails it, which is the point.

- Costs: one extra round trip on first play (invisible mode usually ~0), a
  dependency on Cloudflare's script, and a real risk of blocking a legitimate
  browser with aggressive privacy settings. Always provide a fallback path.

### 3.5 Behaviour scoring — **accept (cheap version)**

Log, per session: resolves/min, segments/min, and playback progress from the
player. A real viewer requests segments at playback speed (one per 2-6 s); a
downloader bursts. A simple ratio (segments requested ÷ seconds of progress) over
a 2-minute window is enough to flag. Start in **log-only** mode; act only after a
week of data.

### 3.6 Honeypot URLs and canary tokens — **accept**

A route that looks like a resolve (`/api/watch/0/0`) and is never linked; any hit
is a scraper. Canary values in the API key name and cron secret so a leaked value
is identifiable in logs. Cheap, no false positives.

### 3.7 Response-payload encryption per session (ECDH + AES-GCM) — **reject**

The key must reach the browser to decrypt, so a determined attacker with devtools
gets it in one step. It only stops someone reading raw network traffic, which TLS
already does. It adds real complexity to every client call. Not worth it.

### 3.8 Segment-level key rotation / AES-128 HLS — **accept only if you already control packaging**

You do not package these streams; the upstream does. Re-encrypting would mean
proxying and re-packaging every segment, which is a large cost for a control that
a script defeats by fetching the key from the same endpoint. If the upstream ever
offers AES-128 with a per-session key URL, take it; otherwise skip.

### 3.9 Watermarking — **conditional**

A per-session overlay (viewer id, timestamp) burned into the video is the only
watermark that survives a re-encode. Doing it properly means transcoding, which is
not realistic here. A DOM overlay is trivially removed. **Do not** watermark with
content you do not hold rights to beyond a visible site mark; legal exposure is
real. Recommend: log the session id server-side and overlay it in the player as a
deterrent only, and say so.

### 3.10 DRM (Widevine/PlayReady/FairPlay) — **reject**

DRM requires packaging with CENC and a licence agreement tied to content rights.
For third-party streams without licences this is not available, and Cloudflare's
own DRM documentation restricts FairPlay credentials to parties acting for content
owners. Widevine is a licence gate, not an anti-capture guarantee: a licensed
client can still be screen-recorded.

### 3.11 Hotlink and Referer/Origin enforcement — **accept**

Reject resolve requests whose `Origin` is not `https://kumoritv.top` (allow the
mobile app origin if one exists). Cheap, stops the laziest mirrors. Spoofable
server-side, so it is a filter, not a wall.

### 3.12 Headers: CSP, HSTS, COOP/CORP, Permissions-Policy — **accept, staged**

Start with HSTS, COOP, CORP and a Permissions-Policy; add CSP in report-only
because ads and iframes will break otherwise. SRI for any third-party script you
control; not for ad tags (they rotate).

### 3.13 Secrets hygiene — **accept**

`gitleaks` or GitHub secret scanning in CI, `npm audit`/OSV-Scanner weekly,
per-job cron secrets, and a documented rotation. Never log a token (Part A already
logs codes only).

### 3.14 Logging and alerting — **accept**

Log `{route, status, anilistId, episode, ip_hash, asn, session_id, outcome}` and
never the token or the full URL. Alert on: resolve 429 rate, proxy 403 rate,
distinct IPs per session, and any honeypot hit.

### 3.15 Incident playbook — **accept**

1. Rotate `ANI_API_KEY` in Railway, redeploy the frontend service (it reads per
   call, so a restart is enough).
2. Rotate `PROXY_SIGNING_SECRET`: every outstanding proxy URL dies at once.
3. Rotate `CRON_SECRET`; update the scheduler.
4. Block an ASN or IP range in Cloudflare (Security → WAF → Tools), 2 minutes.
5. If accounts are implicated, revoke sessions in Supabase (Auth → Users) and
   force a re-login.

## 4. Staged rollout

Every stage has a flag so it can be turned off in Railway without a deploy.

### Phase 1 — this week, low risk

| Change | Flag | Acceptance test |
| --- | --- | --- |
| RLS migration for the three tables | SQL rollback (drop policy) | anon key cannot select another user's row; the app's own flows still pass |
| Security headers (HSTS, COOP, CORP, Permissions-Policy) | `SECURITY_HEADERS=on` | `curl -I` shows them; player and ads still work |
| Remove `ignoreBuildErrors` | n/a | `tsc` is clean in CI |
| Per-job cron secrets | `CRON_SECRET_<JOB>` | old shared secret returns 401 |
| Honeypot route | always on | a hit is logged with the IP hash |

Rollback: each header block is one `next.config` entry; the RLS policy can be
dropped in one statement.

### Phase 2 — the token system

| Change | Flag | Acceptance test |
| --- | --- | --- |
| 60-120 s segment tokens, manifest 10 min | `PROXY_TOKEN_TTL` | a replayed token after expiry fails |
| Bind tokens to `{anilistId, episode, sessionId}` | `PROXY_BIND_SESSION=on` | a token from episode 1 fails on episode 2 |
| Signed download URLs | `DOWNLOAD_TOKENS=on` | an unsigned download URL returns 403 |
| No upstream host in any body | always | `curl` of resolve/segment has no hostname in the body |

Rollback: set the TTL back to 14400 and the bind flag off; old tokens keep
working.

### Phase 3 — bot challenge and quotas

| Change | Flag | Acceptance test |
| --- | --- | --- |
| Turnstile after a suspicious score | `RESOLVE_CHALLENGE=on` | 100 sequential resolves from one IP are throttled; a normal play is not |
| Cross-instance limiter (Upstash) | `RATE_LIMIT_BACKEND=upstash` | the limit holds with two Railway instances |
| Behaviour scoring log-only | `ABUSE_SCORING=log` | a burst is flagged, a viewer is not |

Rollback: `RESOLVE_CHALLENGE=off`, `RATE_LIMIT_BACKEND=memory`.

## 5. Questions and what I could not verify

1. **Cloudflare plan and cache rules.** Free or Pro? Are any rules `Cache
   Everything` with an Edge Cache TTL on HTML? I cannot read your dashboard from
   here, and this decides whether F10 is real.
2. **Is there a mobile app or other origin** that calls `/api/watch`? That changes
   the Origin allow-list.
3. **Do you want Upstash** (new service, ~1 ms) or Supabase for the shared
   limiter?
4. **Which content may be watermarked?** Anything without rights should not carry
   a forensic mark.
5. **`CRON_SECRET` consumers**: the Railway scheduler, GitHub Actions, or both?
   Rotation needs every caller updated.

Not verified from the sandbox: I cannot reach `kumoritv.top` or
`youradexchange.com`, so nothing here is a live-site test. The RLS findings come
from the migrations in the repo; if the production database has drifted from
them, re-check with the SQL in section 1. Cloudflare behaviour is from its
documentation, not from your zone.

## Sources

- Cloudflare Stream, securing your stream (signed tokens, IP restrictions):
  https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
- Cloudflare WAF rate limiting rules:
  https://developers.cloudflare.com/waf/rate-limiting-rules/
- Cloudflare Turnstile: https://developers.cloudflare.com/turnstile/
- Cloudflare cache behaviour (which responses are cached, `Set-Cookie`):
  https://developers.cloudflare.com/cache/concepts/cache-behavior/
- RFC 8216, HTTP Live Streaming (AES-128 key delivery):
  https://www.rfc-editor.org/rfc/rfc8216
- MDN, Content-Security-Policy:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
- GitHub secret scanning:
  https://docs.github.com/en/code-security/secret-scanning
- OSV-Scanner: https://google.github.io/osv-scanner/

Practitioner judgement, no authoritative source: the segments-per-second abuse
heuristic, the specific TTL numbers, the value of DOM-overlay watermarking, and
the CGNAT false-positive estimate.
