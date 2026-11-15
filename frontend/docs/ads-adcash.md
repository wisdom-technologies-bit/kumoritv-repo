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
