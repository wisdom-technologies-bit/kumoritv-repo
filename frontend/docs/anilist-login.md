# AniList login

How a visitor signs in with AniList, why the old flow failed on production, and
what to set on the AniList developer page and in Railway.

## The failure this fixes

Production showed **"AniList login failed. Please try again."** after the visitor
authorised on AniList. That exact string came from
`app/lib/user/anilistUserLoginOptions.ts` when `getCurrUserData()` returned a falsy
value. Two independent bugs produced it, and both were reproduced locally against
the real modules (not assumed):

| Cause | Evidence |
| --- | --- |
| **1. Firestore after a successful AniList call.** `getCurrUserData` fetched `Viewer` and then called `createNewUserDocument` (`app/lib/user/userLoginActions.ts:26` → `getFirestore(initFirebase() as any)`). With no Firebase config in the build, `getFirestore(null)` throws, the `catch` returns `undefined`, and the login is reported as failed although AniList accepted the token. The Supabase bridge was never reached. | Repro run with `NEXT_PUBLIC_FIREBASE_API_KEY` unset and a stubbed AniList response: `ANILIST_REQUEST_URLS=["https://graphql.anilist.co"]`, `RETURNED=undefined`, thrown `TypeError: Cannot read properties of null (reading 'container')`. |
| **2. No fallback for the API URL.** `const ANILIST_URL = process.env.NEXT_PUBLIC_ANILIST_API_URL` with no default: a build without the variable sent the request to the literal string `"undefined"`. | Same repro with the variable unset: `ANILIST_REQUEST_URLS=["undefined"]`, `RETURNED=undefined`. |

Both are fixed by making the viewer come from **one** server call and by reading
the endpoint from one shared constant.

## The flow, in words

### Implicit grant (default, `ANILIST_AUTH_FLOW` unset or `implicit`)

1. The visitor clicks AniList in the login modal. The button navigates to
   `/auth/anilist/start` (server side).
2. With the flag at `implicit`, that route redirects to
   `https://anilist.co/api/v2/oauth/authorize?client_id=…&response_type=token`.
3. AniList sends the visitor back to the registered URL with
   `#access_token=…&token_type=Bearer&expires_in=…` in the fragment.
4. `handleAnilistUserLoginWithRedux` parses the fragment, removes it from the
   address bar, and posts `{accessToken, tokenType, expiresIn}` to
   `/api/auth/anilist-session`.
5. The route validates the token's audience and subject locally, calls AniList
   **once** for `Viewer` (8 s timeout, one retry for network errors only), links
   or creates the Supabase account, and answers with
   `{ok, linked, viewer, seededTitleLanguage}` plus the httpOnly token cookie.
6. The browser builds the redux/localStorage user from that response. No second
   call to AniList, no Firestore.

### Authorization-code grant (`ANILIST_AUTH_FLOW=code`)

1. `/auth/anilist/start` mints a signed `state` (nonce + issue time, HMAC-SHA256
   with a key derived from `ANILIST_TOKEN_ENCRYPTION_KEY`), stores the nonce in an
   httpOnly `anilist_state` cookie, and redirects to AniList with
   `response_type=code&redirect_uri=…/auth/anilist/callback&state=…`.
2. AniList sends the visitor to `/auth/anilist/callback?code=…&state=…`.
3. The callback verifies the signature, the 10-minute age and the cookie nonce,
   then exchanges the code at `https://anilist.co/api/v2/oauth/token` with the
   client id, `ANILIST_CLIENT_SECRET` and the registered redirect URI. This is
   server to server; the secret never leaves Railway.
4. The token is stored **only** in the httpOnly `access_token` cookie, encrypted
   with AES-256-GCM (`ANILIST_TOKEN_ENCRYPTION_KEY`), and the account is linked.
   The browser is redirected to `/?anilist=linked`.
5. The client asks `/api/auth/anilist-session` (GET) for the viewer. The token is
   never in the URL, in the HTML or in client JavaScript.

If `ANILIST_TOKEN_ENCRYPTION_KEY` is missing or not 64 hex characters while the
flag is `code`, the flow fails closed with `ANILIST_CONFIG_MISSING` and no cookie
is written. The implicit flow does not need the key.

## Where the token lives

| Flow | Cookie | Format |
| --- | --- | --- |
| implicit | `access_token`, httpOnly, SameSite=Lax | JSON `{accessToken, tokenType, expiresIn}` |
| code | `access_token`, httpOnly, SameSite=Lax | `v1.<iv>.<tag>.<ciphertext>`, AES-256-GCM |

`readAnilistToken()` accepts both. Nothing returns the token to browser
JavaScript: `GET /api/anilist` is a status check only, and the favourite / list /
notification buttons post their GraphQL to `/api/anilist/proxy`, which adds the
`Authorization` header server side.

## Error codes

Every failure is logged server side as `[anilist] code=… detail=…` (never the
token) and shown in the toast as a sentence plus `code: …` in small print.

| Code | Meaning | HTTP |
| --- | --- | --- |
| `ANILIST_TOKEN_MISSING` | No token in the redirect or the cookie | 400 / 401 |
| `ANILIST_VIEWER_400` | AniList could not read the token | 400 |
| `ANILIST_VIEWER_401` | AniList rejected the token (or the subject did not match) | 401 |
| `ANILIST_VIEWER_TIMEOUT` | AniList did not answer within 8 s | 504 |
| `ANILIST_VIEWER_UNREACHABLE` | Network error after one retry, or a 5xx | 502 |
| `ANILIST_RATE_LIMITED` | AniList or our own limiter said slow down | 429 |
| `ANILIST_SYNC_FAILED` | Supabase could not link or create the account | 500 / 503 |
| `ANILIST_CONFIG_MISSING` | Missing client id, secret, or encryption key | 503 |
| `ANILIST_STATE_INVALID` | Bad, expired or replayed `state` | redirect |
| `ANILIST_CODE_EXCHANGE_FAILED` | AniList refused the code exchange | redirect |

## Debugging from a phone

1. Screenshot the toast. The `code:` line names the failure; the sentence is the
   same one a desktop user sees.
2. In Railway → the frontend service → Logs, search for `[anilist] code=`. The
   line carries the code and a short detail (an HTTP status, `encryption_key`,
   `no_code`, a state reason). It never carries a token.
3. `ANILIST_VIEWER_401` on every device usually means the client id in the build
   does not match the AniList app (or the token is older than the app).
4. `ANILIST_CONFIG_MISSING` with `detail=encryption_key` means the flag is `code`
   but the key is absent: either set the key or put the flag back to `implicit`.
5. `ANILIST_SYNC_FAILED` means AniList accepted the login and Supabase did not.
   Check the Supabase project status and the service-role key.

## What to set

### AniList developer page (https://anilist.co/settings/developer)

| Field | Value |
| --- | --- |
| Name | KumoriTV |
| Redirect URL | `https://kumoritv.top/auth/anilist/callback` |

The redirect URL only matters for the code grant. Add it before flipping the flag;
the implicit grant keeps using the URL already registered on the app.

### Railway (frontend service)

| Variable | Example | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_ANILIST_CLIENT_ID` | `12345` | no |
| `NEXT_PUBLIC_ANILIST_API_URL` | `https://graphql.anilist.co` (optional; this is the default) | no |
| `NEXT_PUBLIC_SITE_URL` | `https://kumoritv.top` | no |
| `ANILIST_AUTH_FLOW` | `implicit` or `code` | no |
| `ANILIST_CLIENT_SECRET` | the secret from the AniList app | **yes** |
| `ANILIST_TOKEN_ENCRYPTION_KEY` | 64 hex characters (`openssl rand -hex 32`) | **yes** |

`NEXT_PUBLIC_*` values are baked in at build time: change them in Railway and
redeploy, not just restart.

### SQL (run before deploying with the seeding enabled)

```sql
-- Run order: 1. This column lets the AniList login seed the title language only
-- when the user has never chosen one in KumoriTV.
alter table public.profiles
  add column if not exists title_language_source text not null default 'default'
  check (title_language_source in ('default', 'anilist', 'user'));
```

Without the column the login still works; it simply skips the seed (the bridge
treats a missing column as "cannot tell, so do not overwrite").

## Firebase inventory after this change

| File | Reachable at runtime? | Replacement |
| --- | --- | --- |
| `app/firebaseApp.ts` | **deleted** | — |
| `app/lib/user/userLoginActions.ts` | **deleted** | `/api/auth/anilist-session` (Supabase) |
| `app/lib/user/userDocUpdateOptions.ts` | **deleted** | Supabase data layer (`app/lib/user-data/*`) |
| `app/api/anilist/anilistUsers.ts` | yes (login path) | viewer only; no Firestore import |
| `app/ts/interfaces/firestoreData.d.ts` | types only, no runtime | unchanged (renaming is out of scope) |
| `firebase`, `react-firebase-hooks` in `package.json` | **removed** | — |

`app/lib/user-data/__tests__/firebase-boundary.test.ts` now allows no file to
import the SDK, and `app/__tests__/partA-anilist-login.test.ts` asserts the login
files are clean.
