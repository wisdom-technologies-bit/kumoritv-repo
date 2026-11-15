# Push notifications (OneSignal) - audit and owner checklist

The code path was audited end to end on 2026-11-15. Everything below is either a
code fact (with the file) or an owner action. Nothing here proves delivery on a
real device: a browser subscription cannot be verified from a server.

## What the code does now

| Link | State | Evidence |
| --- | --- | --- |
| App id | `NEXT_PUBLIC_ONESIGNAL_APP_ID` is read with a static `process.env.NEXT_PUBLIC_...` expression in `app/lib/push/config.ts`, so Next inlines it **at build time**. If Railway did not have it when the build ran, `pushConfigured()` is false and nothing initialises. | `onesignalAppId()`, `pushConfigured()` |
| SDK init | Only for a signed-in Supabase user (`PushProvider` -> `syncPushIdentity`), never for a guest, one init promise. | `app/lib/push/runtime.ts` |
| Worker path | `/push/onesignal/OneSignalSDKWorker.js`, scope `/push/onesignal/`, `importScripts` of the v16 SDK. Middleware matcher excludes `push/`, and `next.config.mjs` now sends `Service-Worker-Allowed: /push/onesignal/` plus `Cache-Control: public, max-age=0, must-revalidate` and `nosniff`. `public/sw.js` (the ad provider's worker) is untouched. | `public/push/onesignal/*`, `next.config.mjs`, `middleware.ts` |
| Permission | Only the Settings toggle calls `requestPushPermissionAndOptIn()`; no autoprompt, no slide-down, no notify button. Denied/unsupported/iOS-not-standalone are surfaced in plain words. | `NotificationsSection.tsx`, `state.ts` |
| Identity | `OneSignal.login(<supabase user id>)` after the user is known; sign-out logs the browser out. | `syncPushIdentity()` |
| Server send | `POST https://api.onesignal.com/notifications` with `Authorization: Key <ONESIGNAL_REST_API_KEY>`, `target_channel:"push"`, `include_aliases.external_id`, `headings`/`contents`, optional `url`, `chrome_web_icon`, `big_picture`, `web_push_topic`, `idempotency_key` = `<key>:<chunkIndex>`, 2000 ids per chunk. | `app/lib/push/onesignal.ts` |
| Failure logging | Each failed chunk's OneSignal message is stored on the outbox row; the key is never logged. | `onesignal.ts` + `/api/cron/push` |
| Diagnostics | `GET /api/admin/push-status` (header `x-cron-secret`) -> `{appIdPresent, restKeyPresent, workerUrlOk, outbox:{pending,sent,failed,lastError,lastSentAt}, lastCronRunAt, subscribedUsers}` | `app/api/admin/push-status/route.ts` |
| Self test | Settings > Notifications > **Send me a test notification**: real push to your own External ID, 1/minute, result in words. | `app/api/push/test`, `NotificationsSection.tsx` |
| CSP | There is **no** Content-Security-Policy anywhere in `next.config.mjs` or `middleware.ts` (checked), so nothing blocks `https://cdn.onesignal.com` or `https://*.onesignal.com`. If you add one later, `script-src` needs `https://cdn.onesignal.com` and `connect-src` needs `https://*.onesignal.com`. | grep of `next.config.mjs`, `middleware.ts` |

## Owner checklist (OneSignal dashboard)

1. **Settings > Platforms > Web**: Site Name `KumoriTV`.
2. **Site URL**: exactly `https://kumoritv.top` (no `www`, no trailing slash, https).
3. Integration: **Custom Code** (not "Typical Site").
4. Permission prompt: **off by default** (we ask only from the Settings toggle).
5. Default icon URL: a 256x256 PNG.
6. **Auto Resubscribe**: on.
7. **Advanced Push Settings > "My site's service worker is not at the root"**: on.
   * Path to service worker files: `push/onesignal/`
   * Main service worker filename: `OneSignalSDKWorker.js`
   * Updater service worker filename: `OneSignalSDKUpdaterWorker.js`
   * Service worker registration scope: `/push/onesignal/`
8. **App ID** (Settings > Keys & IDs, the public one) -> Railway variable
   `NEXT_PUBLIC_ONESIGNAL_APP_ID` and it must be a **BUILD** variable, then
   redeploy (a runtime-only value is too late: Next inlines it at build).
9. **REST API Key** (Settings > Keys & IDs; use the **App** API key with scope
   `Apps: all`/this app, never the Organization key) -> Railway variable
   `ONESIGNAL_REST_API_KEY` as a runtime variable.
10. Open **Audience > Subscriptions**: after you turn the toggle on, your browser
    subscription must appear with **External ID = your Supabase user id** and
    **Status: Subscribed**.
11. **Delivery > Message Reports** shows accepted/rejected and why.

## What to check in the browser

* Site settings > Notifications = **Allow** (not "Ask", not "Block").
* Not a private/incognito window (subscriptions do not persist).
* Chrome on Android: the site's notification channel is not blocked, and battery
  saver / "Pause notifications" is not on.
* iOS Safari: the site must be added to the **Home Screen** and opened from
  there; push does not exist in an iOS Safari tab.

## Cloudflare

* No rule may challenge, cache or block `/push/onesignal/*` (a challenge page
  answers a worker request with HTML and registration fails).
* `/api/*` must not be cached; the push cron and the test endpoint are POST/GET
  with cookies and must reach Railway.

## Proving it in 30 seconds

1. Turn the toggle on (Allow the browser prompt).
2. `/api/admin/push-status` -> `appIdPresent:true`, `restKeyPresent:true`,
   `workerUrlOk:true`, `subscribedUsers` >= 1.
3. Click **Send me a test notification**. "Sent." means OneSignal accepted the
   request for your External ID; anything else names the broken link.
