# Advertising: Adcash

The one place that records how KumoriTV monetises its pages. Read this before
touching any ad code, and update it in the same commit if you do.

## (a) Current provider

| | |
|---|---|
| Provider | **Adcash** (Autotag) |
| Zone id | `wdslld7xas` (Autotag zone generated for `https://kumoritv.top`) |
| Previous provider | Monetag - removed completely on **2026-11-15**, see (e) |
| Changed | **2026-11-15** (Prompt 39B) |
| Live by default? | **No.** `ADCASH_ENABLED` is unset/`0`, so a deploy of this code renders no ad markup at all. The owner turns it on with one Railway variable, see (d). |
| Format | Autotag only: one script, no slot of ours. Popunder/push/interstitial behaviour is chosen in the Adcash dashboard, not in this repo. |

## (b) Official Adcash snippet (verbatim)

Step 1: Include Adcash library. Place the following JS script inside <head></head> of your page as high as possible. If you already have the Adcash lib included, skip this step.
```html
<script id="aclib" type="text/javascript" src="//acscdn.com/script/aclib.js"></script>
```

Step 2: Put the tag script on the page. Paste it below the first library script.
```html
<script type="text/javascript">
    aclib.runAutoTag({
        zoneId: 'wdslld7xas',
    });
</script>
```

## (c) How it is implemented here

Next 14 App Router, so the two steps become one client component and one prop
bundle. Nothing about the snippet's **order** or **once-per-load** behaviour
changes.

| Piece | File |
|---|---|
| Config + the "run it once" guard (pure, testable) | `app/lib/ads/adcash.ts` |
| The tag itself (step 1 + step 2) | `app/components/Ads/AdcashTag.tsx` |
| Where it is rendered | `app/layout.tsx`, inside `<head>` (where the old tag was) |
| The self-removing worker left behind by Monetag | `public/sw.js` |
| Its no-cache header | `next.config.mjs` (`source: '/sw.js'`) |
| Tests | `app/__tests__/prompt39b-adcash.test.tsx`, `app/__tests__/prompt39b-sitemap-refresh.test.ts`, `app/__tests__/prompt39b-downloads-and-sw.test.ts` |

### The two steps, in order

1. **Library.** `<Script id="aclib" src="https://acscdn.com/script/aclib.js">`.
   The absolute `https://` URL is used on purpose: the snippet's `//acscdn.com/...`
   protocol-relative form breaks if the page is ever served over `file:` or
   another protocol, and Next's loader wants a real URL. The element id stays
   `aclib`, which is also what the browser check in (d) looks for.
2. **Tag.** `aclib.runAutoTag({ zoneId })`, called from the Script's `onReady`
   and `onLoad` handlers. Both are wired because they fire in different orders on
   a cold load versus a warm cache; `runAdcashAutoTag()` keeps a module-level
   flag, so the second call is a no-op. That single flag also covers React strict
   mode running effects twice and client-side navigations remounting the
   component: **one Autotag per full page load**, which is what step 2's
   "paste it below the library" means in practice. The call is wrapped in
   `try/catch` behind a `typeof window.aclib?.runAutoTag === "function"` guard,
   so a blocked, slow or broken library renders a page with no ad and no error.

### Why `afterInteractive` and not `beforeInteractive`

`beforeInteractive` is only honoured for scripts placed **directly** in
`app/layout.tsx`, it cannot be rendered conditionally per request, and it has no
`onLoad`/`onReady` callback - so step 2 would have no reliable trigger, and an ad
would block hydration. `afterInteractive` is the earliest strategy that still
gives us "step 1 finished, now step 2" and keeps the page's own JavaScript
first. That is the choice made here.

### Configuration

Read at render time in the root layout, passed to the component as props. No
`NEXT_PUBLIC_` variable is needed, because the value never has to be read in the
browser before render, and no server-only variable can leak into a client
bundle.

| Variable | Default | Meaning |
|---|---|---|
| `ADCASH_ENABLED` | `0` | `1`/`true`/`yes`/`on` loads the tag. Anything else renders nothing. |
| `ADCASH_ZONE_ID` | `wdslld7xas` | Zone id. An empty value falls back to that default. |
| `ADCASH_EXCLUDE_PATHS` | `/admin,/api,/community-off,/notifications/welcome` | Comma list of path prefixes that never load the tag. `/admin` covers everything under it; `/admin-tools` is *not* matched. |

`app/lib/ads/adcash.ts` holds those defaults as constants, so the component never
contains a literal zone id.

### Where the tag is not

Rendered once, globally, in the root layout. It is **not** placed inside the
video player component, the community composer, or any admin page
(`/admin` and `/api` are excluded), and this change adds no second slot, banner,
popup or direct-link button of its own. The adult-content filter is a per-viewer
preference kept in the browser, so a globally rendered tag cannot be gated on it;
the old tag was not gated on it either (see (g)).

## (d) Operating it

### Turn it on (Railway)

1. Railway -> the KumoriTV service -> **Variables** -> add
   `ADCASH_ENABLED` = `1`.
2. Optional: `ADCASH_ZONE_ID` = your zone (only if it is not `wdslld7xas`) and
   `ADCASH_EXCLUDE_PATHS` if you want a different exclusion list.
3. **Redeploy** (Railway -> Deploy -> Redeploy). The root layout is a server
   component: dynamic routes read the variable per request, but a route that was
   statically generated keeps the value it was built with, so a redeploy is what
   makes the switch certain.
4. Check it in the browser (below).

### Change the zone id

Railway -> `ADCASH_ZONE_ID` = the new zone -> Redeploy. Nothing else changes: the
zone id is a prop, not code. Keep `docs/ads-adcash.md` (a) in step with it.

### Turn it off in 30 seconds

Railway -> set `ADCASH_ENABLED` = `0` (or delete the variable) -> Redeploy. The
component returns `null`, so the page ships no `aclib` element and no Autotag
call. No code change, no SQL, no cache to clear. `ADCASH_EXCLUDE_PATHS` = `/`
turns it off for every path without a redeploy of anything else, if you want a
freeze without a variable change.

### Verify it in the browser

- **View source** (Ctrl+U) on any page: exactly one `<script id="aclib" ...>` and
  no other `aclib.js`. With `ADCASH_ENABLED=0` it must be absent entirely.
- **DevTools -> Network**, filter `aclib`: one request to
  `acscdn.com/script/aclib.js`, `200`, `text/javascript`.
- **DevTools -> Console**: no error from `aclib`. If you see
  `aclib is not defined`, step 2 ran before step 1 finished - that is the bug
  `runAdcashAutoTag` exists to prevent, so check that
  `app/components/Ads/AdcashTag.tsx` still wires `onReady`/`onLoad`.
- On `/admin`, `/api/*`, `/community-off` and `/notifications/welcome` the
  `aclib` element must not appear at all.

## (e) Monetag removal log

Date of removal: **2026-11-15**. Last commit that still contains the old code:
**`b1ac348`** (the tip of `fixes-39` before this change). Anything removed here
can be read back with `git show b1ac348:frontend/<path>`; nothing needs an
archive.

| # | File / line at `b1ac348` | What it did | Belonged to Monetag? | Action |
|---|---|---|---|---|
| 1 | `app/layout.tsx:66-71` | Inline `<script>` in `<head>` that appended `https://al5sm.com/tag.min.js` with `data-zone='12159142'` | Yes: tag host `al5sm.com`, zone `12159142` (same `12159xxx` block as the other two artefacts) | Removed; replaced by `<AdcashTag>` |
| 2 | `public/sw.js:1-6` | Service worker at scope `/`: `self.options = {domain:"3nbf4.com", zoneId:12159070}` + `importScripts('https://3nbf4.com/act/files/service-worker.min.js?r=sw')` | Yes: the provider's own worker, registered by artefact 1's script | Replaced by the self-removing stub (below) |
| 3 | `app/lib/push/config.ts:24-25` | Comment: "public/sw.js belongs to the ad provider and must stay untouched" | Comment only | Rewritten to describe the stub; no behaviour change |
| 4 | `next.config.mjs:49-52` | Comment referring to the ad provider's worker | Comment only | Rewritten, and `/sw.js` now gets `Cache-Control: no-cache` |
| 5 | `docs/push.md:13` | Same claim in the push documentation table | Documentation | Rewritten |
| 6 | `app/lib/downloads/__tests__/downloads.test.ts:159,162,169` | Used `https://uplcm.com/4/12159130` as a sponsor-link fixture | Yes: Monetag direct link, zone `12159130` | Fixture changed to `https://ads.example.com/click` |
| 7 | `app/watch/[id]/components/DownloadEpisode/__tests__/sheet.test.tsx:58` | Same URL as a fixture | Yes | Same change |
| 8 | `public/ads.txt` | Would list ad sellers | File does not exist | Nothing to remove |
| 9 | `public/robots.txt` | - | No such file: robots is `app/robots.ts`, which mentions only `/sitemap.xml` | Nothing to remove |
| 10 | `middleware.ts` | - | No ad reference at all | Untouched |
| 11 | `.env.example` | - | The tag was hard-coded, so **no Monetag environment variable ever existed** | Nothing to delete; the `ADCASH_*` variables are added instead |
| 12 | `public/push/onesignal/*`, `app/lib/push/*` | Web push | Not Monetag | **Untouched** (only a comment changed) |
| 13 | `app/googleAnalytics.tsx`, `@vercel/analytics` | Analytics | Not Monetag | **Untouched**. No AdSense/Google ad code exists in the repo |

Unattributed hits: none. Everything that matched `monetag`,
`propeller(ads)`, `pushsdk`, `onclckmn`, `alwingulla`, `nap5k`, `inklinkor`,
`5gvci`, `gizokraijaw`, `data-zone`, `data-cfasync`, `al5sm`, `3nbf4` and
`uplcm` is listed above. `data-cfasync` and the other hashed hostnames were not
present anywhere.

A test now fails if the string `monetag`, `al5sm.com`, `3nbf4.com`, `uplcm.com`
or a `12159xx` zone id reappears in `app/`, `public/`, `middleware.ts`,
`next.config.mjs` or `.env.example` (see the test file in (c)).

### `public/sw.js` must stay for at least 60 days

The old worker is **already installed in visitors' browsers**. Deleting the file
would not remove it: a browser keeps a service worker until its own code
unregisters it, so the old one would keep serving its ads and push forever. So
the same URL now serves a stub that:

- on `install` calls `self.skipWaiting()`, taking over at once instead of waiting
  for every tab to close;
- on `activate` deletes every cache, calls `self.registration.unregister()`, then
  reloads open windows with `clients.matchAll({type:"window"})` and
  `client.navigate(client.url)` so each tab is served without a worker;
- has no `fetch` handler, so nothing is intercepted while it is in place.

`next.config.mjs` forces `Cache-Control: no-cache, no-store, must-revalidate` on
`/sw.js`, and `Service-Worker-Allowed: /` keeps its scope at the root, so every
browser update check re-reads the stub instead of trusting a cached copy.

**Keep this file until at least 2027-01-14** (60 days after 2026-11-15). After
that it may be deleted, because by then every returning visitor's update check
will have fetched it. Nothing in this repo registers `/sw.js` any more (a test
asserts that), and the OneSignal worker keeps its own scope at
`/push/onesignal/` and is unaffected.

## (f) Same thing on another site

1. Create the Adcash zone for that site and note the zone id.
2. Copy `app/lib/ads/adcash.ts` (constants + guard) and
   `app/components/Ads/AdcashTag.tsx` unchanged.
3. Read the three variables in that site's root layout and render
   `<AdcashTag enabled zoneId excludePaths />` inside `<head>`, behind
   `ADCASH_ENABLED` defaulting to off.
4. Add the `/sw.js` no-cache header, and - only if that site also had a Monetag
   worker - ship the self-removing stub and keep it for 60 days.
5. Exclude the admin, API and internal paths particular to that site.
6. Copy the test file: disabled renders nothing, excluded path renders nothing,
   exactly one `id="aclib"`, `runAutoTag` called once with the zone id, no throw
   when the library is missing.
7. Write down the provider, the date, the zone id and the removal log for the old
   provider, exactly like this file.

## (g) Known limits and what could not be verified

- **Real ad serving.** Nothing here proves that a request is filled. That needs a
  real browser on the live site with `ADCASH_ENABLED=1`; the sandbox can only
  check markup and code paths.
- **The library's other hostnames.** `https://acscdn.com/script/aclib.js` *is*
  reachable from this sandbox (`200`, `text/javascript`, 176,727 bytes, served
  from Google Cloud Storage with `access-control-allow-origin: *`), but the file
  is obfuscated and contains no plain hostnames, and `curl` fetches nothing else.
  The further hosts the Autotag code contacts cannot be enumerated statically, so
  they are not guessed here: read them from DevTools -> Network on the live site.
- **CSP.** There is no `Content-Security-Policy` anywhere in this repo today
  (checked in `next.config.mjs`, `middleware.ts` and the app). If one is added,
  `script-src` must include `https://acscdn.com`, `connect-src`/`img-src`/`frame-src`
  must allow whatever hosts the Network panel above shows, and `worker-src` must
  still allow the OneSignal worker path.
- **Consent.** The old tag was loaded unconditionally in `<head>`: there is no
  cookie/consent banner and no gate in `app/api/cookie` (that route only stores
  the user's own preferences). This tag keeps exactly that behaviour - it is not
  gated on consent - so if a consent mechanism is introduced, gate the tag in the
  same place (one component, one condition).
- **The adult filter** is a browser preference applied to catalogue lists, not a
  server-side gate, so the global tag cannot respect it. The old tag did not
  either.
- **Other features.** This change adds no global click handler and no overlay of
  its own, so the download sheet, the OneSignal toggle and the player are
  untouched in code. Whether the *Adcash* formats (popunder/onclick) open over
  them is decided in the Adcash dashboard and can only be judged on the live
  site.

---

# In-stream video (pre-roll)

An Adcash **In-stream Video** zone played inside our own player on the watch page,
with our own overlay chrome and a Skip button. Everything here is behind flags and
**off by default**: with the defaults below the site is byte-for-byte what it is
today - no script is loaded, no request is made, no DOM is added.

## 1. Owner's dashboard steps (Adcash panel)

1. Adcash panel -> **Create zone** -> **In-stream Video**.
2. Add the site `kumoritv.top` to the zone if it is not there yet.
3. Copy the zone's **VAST Tag URL**. It looks like
   `https://youradexchange.com/video/select.php?r=<REQUEST_ID>`
   (host `youradexchange.com`, zone request id in `r`). The literal value belongs
   to the Adcash panel and to Railway's environment - it is deliberately **not**
   written into this repository.
4. Paste it as `ADCASH_VAST_URL` on Railway (see section 3), and set
   `PREROLL_ENABLED=1` when you are ready to test. Nothing plays before that.
5. Adcash's own instructions plug that tag into a VAST-compatible player and show
   Video.js + `videojs-ima`. That is the same SDK this integration uses by default,
   so the pre-roll runs where Adcash expects it to.

## 2. VAST URL handling

- The tag is **configuration, not a secret**, but it is never hard-coded: it comes
  from `ADCASH_VAST_URL` at request time (`app/lib/ads/preroll.ts`,
  `readPrerollConfig`).
- It is read **on the server** (watch page) and passed to the client as a prop. No
  `NEXT_PUBLIC_` copy exists.
- The tag is requested **by the viewer's browser**, never by our server: the ad
  server must see the viewer's own IP and user agent or fill collapses. There is
  no proxy route for it, deliberately.
- The tag may carry query tokens; nothing about it is logged. The outcome log line
  contains only `kind`, `reason` and `ms`.

## 3. Environment variables (all read at request time)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PREROLL_ENABLED` | `0` | Master flag. `1`/`true`/`on` turns it on. |
| `ADCASH_VAST_URL` | empty | The zone's VAST Tag URL. Empty = off, whatever the flag says. Must be `https://`. |
| `PREROLL_INTERVAL_MIN` | `20` | At most one pre-roll per viewer per N minutes (`0` = every eligible play). |
| `PREROLL_SKIP_AFTER_SEC` | `5` | Skip appears after this many ad seconds **only when the VAST has no `skipoffset`**. Clamped to 10. |
| `PREROLL_MAX_AD_SEC` | `30` | An ad longer than this is treated as "no ad". |
| `PREROLL_START_TIMEOUT_MS` | `6000` | Budget for the creative to start (also the IMA SDK load budget). |
| `PREROLL_VAST_TIMEOUT_MS` | `4000` | Budget for one VAST document fetch (fallback engine). |

`enabled = PREROLL_ENABLED && https VAST url`. Both are required, so either one
turns the feature off without a deploy.

## 4. How it is wired

Files:

| File | Role |
| --- | --- |
| `app/lib/ads/preroll.ts` | Config, eligibility, localStorage/sessionStorage, circuit breaker, counters. Pure. |
| `app/lib/ads/preroll-server.ts` | Server side: reads the flags, resolves `staff_roles` and the adult setting. Returns `null` while off. |
| `app/watch/[id]/page.tsx` | Calls `readPrerollProps(...)`, passes `preroll` to the player. |
| `app/watch/[id]/components/VideoPlayer/index.tsx` | Arms the pre-roll on the first Play and starts the content when it ends. |
| `app/watch/[id]/components/VideoPlayer/PrerollAd.tsx` | The overlay + the engine chain (IMA -> our VAST client). |
| `app/watch/[id]/components/VideoPlayer/preroll.module.css` | Overlay chrome ("Ad" badge, countdown, Skip, Mute, Visit advertiser). |
| `app/lib/ads/preroll-engine.ts` | Shared engine types + `prerollSkipUi`. |
| `app/lib/ads/preroll-ima.ts` | Google IMA SDK engine (default). |
| `app/lib/ads/preroll-vast.ts` | First-party VAST client (fallback). |
| `app/lib/ads/vast.ts` | VAST 2/3/4 parser, media selection, macros, error codes. |

Flow (text diagram):

```
viewer presses Play
        |
        v
media-play-request (cancelable)  -------------> prerollEligibility()
        |                                        |  not eligible
        | preventDefault()                       v
        |                                  content plays (log: not_shown/<reason>)
        v
PrerollAd overlay inside <MediaPlayer>
        |
        +--> startImaPreroll()  --(ima3.js cannot load)--> startVastPreroll()
        |
        |  outcome: completed | skipped | no_fill | error | timeout
        v
finishPreroll() -> overlay removed -> player.play()   (same task, <300ms)
```

The content stream is resolved by the existing route in parallel: the ad hides
the latency instead of adding to it. The content element is paused under the
overlay, so nothing plays audibly behind the ad.

### Mechanism decision (a) vs (b)

**(a) Google IMA SDK is the default.** Adcash's published instructions for this
zone type are "plug the tag into a VAST-compatible player", and their example is
Video.js + `videojs-ima`, i.e. exactly this SDK. It also settles the two unknowns
the sandbox could not check: IMA fetches the tag itself, so CORS cannot block it,
and it plays VPAID/JS creatives and nested wrappers, which a first-party client
would have to reject. IMA renders its own ad badge, countdown, native skip and
click-through in the ad container, which is what the tag's policy expects; our
overlay adds the "Ad" label, the countdown and a mute toggle, and does not draw a
second skip button while IMA's is on screen.

**(b) our VAST client is the fallback**, used only when `ima3.js` itself cannot
load (blocked by an extension, CSP, offline). It fetches the VAST directly from the
browser, follows wrappers to depth 3, picks the best MP4 for viewport/bandwidth,
plays it in our own `<video>` inside the overlay, and fires
Impression/creativeView/start/firstQuartile/midpoint/thirdQuartile/complete/skip/
mute/unmute/error once each with `[CACHEBUSTING]`, `[TIMESTAMP]`, `[ERRORCODE]`,
`[CONTENTPLAYHEAD]`, `[ASSETURI]` replaced. It rejects VPAID and HLS creatives.

Why the ad plays in its own `<video>` element (both engines): the content element
is never touched, so ad seconds cannot reach `onTimeUpdate`, progress saving,
watch marks or the skip-intro/outro logic.

## 5. Eligibility (all must hold)

- `PREROLL_ENABLED=1` and a usable `ADCASH_VAST_URL`;
- the player is the hls/mp4 path, **not** the embed iframe path;
- the viewer did not resume mid-episode (saved progress <= 30s);
- the interval cap allows it (`PREROLL_INTERVAL_MIN`, last ad time in
  `localStorage`, plus a `sessionStorage` marker so two tabs cannot double it);
- it is not a server-switch re-resolve (same player instance, one decision per play);
- an auto-next within 5 minutes of the previous ad does not get one;
- the viewer is not staff (`public.staff_roles`), checked on the server;
- an adult-flagged title for a viewer who has not enabled the adult setting.

It runs on the **first Play of an episode only**: never on pause, seek, resume or
during playback, and never twice for one play.

## 6. Failure rules (content is never blocked)

Fetch timeout, HTTP error, empty `<VAST/>` (no fill), unsupported creative (VPAID
in the fallback engine), media load error, start timeout, an ad longer than
`PREROLL_MAX_AD_SEC`, any exception: the overlay is removed, the content starts,
the VAST `Error` URL is fired with the matching code where applicable
(100 parse, 301 timeout/fetch, 302 wrapper limit, 303 no fill, 403 no usable
MediaFile, 405 media error / ad too long, 900 unknown), and exactly one line is
logged:

```
preroll_outcome kind=no_fill reason=no_fill ms=412
```

No URL, no query tokens. There is no retry for the same play and never two ads.

**Circuit breaker**: three consecutive failures inside ten minutes stop ad requests
for thirty minutes (state in `localStorage` and in memory). A no-fill is a normal
outcome and does not count as a failure.

**Ad blockers / privacy**: a blocked script or request is a silent "no ad" - no
error banner, no console noise beyond the one outcome line. No viewer personal
data is sent beyond what the ad server receives by default.

**Consent**: the site's cookie store (`/api/cookie` -> `/api/adult-content`,
`/api/media-title-language`, `/api/subtitle`) gates content preferences only. The
Adcash Autotag already loads without a consent gate, and the pre-roll keeps parity
with it: no gate, same treatment. If a consent gate is added later, the pre-roll
must read the same flag before requesting the tag.

## 7. Turning it off in 30 seconds

Set `PREROLL_ENABLED=0` (or clear `ADCASH_VAST_URL`) on Railway and redeploy. The
watch page then returns `preroll: null`, the overlay never mounts and the IMA
script is never requested. Nothing else in the player changes.

## 8. Testing

**With the mock (no ad server involved):** `frontend/test-harness/preroll-e2e`
serves an inline VAST with a generated MP4, a no-fill VAST and a slow VAST, and
runs the watch page with the flags on. It asserts the ad plays first, Skip appears
at the offset, the content starts afterwards, tracking pixels fire once each, and
that no-fill/slow still start the content inside the timeouts.

**With the real tag** (owner, on a phone or desktop):

```bash
curl -s -A 'Mozilla/5.0 (Linux; Android 13)' -e 'https://kumoritv.top/' "$VAST" | head -c 3000
```

An empty body or `<VAST/>` with no `<Ad>` means "no fill from this network" -
that is a normal state and the site shows the episode without an ad. In the
browser, open the watch page on an episode with no saved progress (<30s), press
Play once and watch for: the black overlay with the "Ad" badge, the countdown,
the Skip button, then the episode starting. In DevTools -> Network, filter
`select.php` and `imasdk` to confirm the tag was fetched by the browser (not the
server) and that `ima3.js` was loaded once.

**Manual checks worth doing once:** 360px and desktop, fullscreen, PiP, keyboard
(space/arrows must move the ad overlay, not the episode), mute, "Visit
advertiser" (new tab, `rel="noopener noreferrer"`), and that the episode's
"watched" mark and progress bar ignore the ad seconds.

## 9. What could not be verified here

- **Real tag behaviour**: `youradexchange.com` answers 403 to the sandbox proxy, so
  the real VAST (version, Inline vs Wrapper, MediaFile types MP4 vs VPAID,
  `skipoffset`, tracking, fill from Nigeria/mobile networks) is unverified. The
  code handles all of those cases; the tests use a mock document shaped like a
  standard inline VAST 4 response.
- **Adcash dashboard counting**: impression/payout numbers can only be confirmed
  in the Adcash panel after real views.
- **Popunder interplay**: the Autotag zone's popunder behaviour alongside an
  in-stream pre-roll is a policy question for Adcash, not something the code can
  see.
- **Mobile autoplay policies**: the pre-roll starts on the viewer's own Play
  gesture, which is the safest case; a browser that still refuses to play will fall
  straight through to the episode.

---

# In-stream video: the tag is empty (2026-11-16)

**Finding.** On 2026-11-16 the owner ran this from Termux (Android UA, `Referer:
https://kumoritv.top/`) against zone `12451816`:

```
<?xml version="1.0" encoding="UTF-8"?><VAST version="4.0"></VAST>
```

That is a **valid VAST document with zero `<Ad>` elements**: no creative, no
impression, nothing to play. In ad terms it is **no fill** - the zone had no
inventory to offer this viewer at that moment. It is not a broken tag, not a
zone misconfiguration on our side and not something a code change can fix: the
server answered exactly what it meant to answer.

### What "no fill" means here

| Signal | Meaning | What KumoriTV does |
|---|---|---|
| `<VAST version="4.0"></VAST>` | no ad for this request | no fill: content plays, no overlay left behind |
| `<VAST>` with `<Error>` only | no ad, plus a reporting URL | same, and the error URL is used when we have one |
| IMA `AD_ERROR` before the creative started (codes 1009/1010/303 etc.) | IMA could not get an ad | treated as **no fill**, not as a failure |
| HTTP error / timeout / blocked script | the request never resolved | treated as **no fill** for the viewer, logged with its reason |
| Ad starts then breaks | a real failure | `error`, counted, circuit breaker |

No fill is not an error: it does not count toward the three-strikes breaker, and
it never leaves a spinner on screen.

### What changed in Prompt 41 (this branch)

1. **Fast no-fill.** `PREROLL_VAST_TIMEOUT_MS` is now `3000` and
   `PREROLL_START_TIMEOUT_MS` is `5000`. The hard stop is
   `start + tag`, capped at **8 s** whatever the env says (it used to be
   `start + tag + 2 s` = 12 s with the old defaults). `ima3` gets
   `adsRequest.vastLoadTimeout = PREROLL_VAST_TIMEOUT_MS`, so IMA stops waiting
   on its own 5 s default.
2. **No-fill cooldown.** After a no-fill the browser remembers
   `noFillUntil = now + PREROLL_NOFILL_COOLDOWN_MIN` (localStorage + memory, in
   `try/catch`). Until then the player behaves exactly as if `PREROLL_ENABLED=0`:
   no request, no overlay, no delay. Counted as `skippedCooldown`.
   `PREROLL_NOFILL_COOLDOWN_MIN=0` disables the cooldown.
3. **The content can no longer start under the ad.** While an ad is pending,
   every `media-play-request`, `media-seek-request` and `media-pause-request` is
   cancelled (capture phase, any trigger), `playing` is stopped again and logged
   as `preroll_content_leak`, and `data-preroll="pending"` on the `<media-player>`
   element hides the play button, poster, control bar, time, sliders, caption and
   settings buttons and the gesture layer. Only `finishPreroll()` starts content.
4. **No stuck "Loading ad…".** The overlay shows a black cover and a spinner with
   one polite "Loading" line for screen readers; the badge, countdown, Mute,
   "Visit advertiser" and Skip appear only once the creative actually plays.
5. **`?prerolldebug=1`** (only with the flag on) prints each step with a
   timestamp in the console and keeps one short line at the bottom of the player,
   which is readable on a phone.

### Environment (full set, with defaults)

| Variable | Default | Notes |
|---|---|---|
| `PREROLL_ENABLED` | `0` | master switch |
| `ADCASH_VAST_URL` | empty | off while empty; the zone tag, never committed |
| `PREROLL_INTERVAL_MIN` | `20` | one pre-roll per viewer per 20 min; `0` = every eligible play |
| `PREROLL_SKIP_AFTER_SEC` | `5` | only when the VAST has no `skipoffset`; clamped to 10 |
| `PREROLL_MAX_AD_SEC` | `30` | longer creative counts as no ad |
| `PREROLL_START_TIMEOUT_MS` | `5000` | engine start (also the IMA SDK load budget) |
| `PREROLL_VAST_TIMEOUT_MS` | `3000` | the tag request itself |
| `PREROLL_NOFILL_COOLDOWN_MIN` | `10` | stay quiet this long after a no-fill; `0` disables |

### Owner's next actions (dashboard, not code)

1. Adcash panel: confirm `kumoritv.top` is **approved for In-stream Video** and
   that zone `12451816` is **active** (not paused, not pending review).
2. Check the zone's **bid/floor**: an empty VAST usually means no bid met the
   floor for this geo (Nigeria), device (Android) or time of day. Lower the floor
   or let it run for a day and retest.
3. Contact Adcash support and quote the finding above verbatim: *"zone 12451816
   returns `<VAST version='4.0'></VAST>` (empty, no Ad) for Nigerian Android
   traffic referred by kumoritv.top"*.
4. Retest with the same curl:

```bash
curl -s -A 'Mozilla/5.0 (Linux; Android 13)' -e 'https://kumoritv.top/' \
  "https://youradexchange.com/video/select.php?r=12451816" | head -c 3000
```

A filled response contains `<Ad>` with `<InLine>` or `<Wrapper>`. While it is
empty, leave the code alone: the player already behaves correctly without ads.
