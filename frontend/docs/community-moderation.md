# Moderation: how it works, and what to run in which order

Phase 6 adds the moderation surface. This is the handbook for whoever runs it,
and the record of what could not be verified from here.

Everything below is behind `COMMUNITY_ENABLED`, read per request. With the flag
off, `/community/admin*` and `/api/community/admin*` answer 404 from middleware,
so the status is real and not a rendered "not found" page.

## 1. Who is staff

Two separate things, deliberately:

- `public.profiles.role` (`'user' | 'moderator' | 'admin'`) drives
  `is_staff()` / `is_admin()`, which every SQL policy and function calls.
- `public.staff_roles` exists from Phase 1 and is no longer the authority for
  anything on the moderation surface. A row there does not grant power.

The app never grants a role. There is no route, no form and no function in Phase
6 that can write `profiles.role`; it is set by hand in the database. That was a
design constraint, not an oversight: a moderation surface that can mint
moderators is a privilege-escalation bug waiting for one bad deploy.

To make someone a moderator:

```sql
update public.profiles set role = 'moderator' where id = '<user uuid>';
```

`'admin'` is the same line with `'admin'`. Both are read on the next request;
there is nothing to restart.

## 2. Where the pages are

| Path | What it is |
| --- | --- |
| `/community/admin` | Counters, then the queue: most-reported first |
| `/community/admin/reports` | The inbox, one row per content item, keyset paginated |
| `/community/admin/reports/<kind>:<id>` | One item: the content, every report, the author's recent history, the log for that item |
| `/community/admin/clips` | Reports against clips |
| `/community/admin/hidden` | Everything currently hidden or removed |
| `/community/admin/log` | The append-only audit log |
| `/community/admin/announcements` | The Phase 4 composer, unchanged |

Every page checks the session server-side with `readStaffForPage()` /
`requireStaffSession()` before it renders anything, and every admin route does
the same before it reads a body. The check runs on the staff member's own
session, so RLS applies on top: a staff policy that is wrong shows up as an
empty page, not as a leak.

The service role is used in exactly three places on this surface, and nowhere
else:

1. `app/lib/community/staff.ts` - the `profiles.role` lookup, because the page
   needs to know whether the viewer is staff before RLS can tell it, and the
   answer returned to the page is a boolean plus a display name.
2. `app/api/community/blocks` - resolving whether the *other* person is staff,
   again only a boolean.
3. Comment writes (`app/api/comments*`), which is Part E: the browser has no
   insert grant any more, and ownership is enforced in the query filter.

## 3. The three actions

One SQL function does all of it: `community_moderate(p_kind, p_id, p_action,
p_reason, p_expected_status)`. It is `security definer`, and the role check is
inside the function, not around it.

| Action | Effect |
| --- | --- |
| `hide` | `status = 'hidden'`, author still sees it with a banner |
| `unhide` | back to `published` |
| `remove` | `status = 'removed'`, hidden from everyone including the author, reason required |
| `restore` | back to `published` |

Clips are the exception to the column names: `clips` already had `deleted_at`
from Phase 5, so "removed" is that timestamp and hiding sets the new
`hidden_at`. Nothing about a clip is called `status`.

Rules the function enforces, in this order:

- not staff: `not_staff` (the route turns that into 403)
- unknown kind, action or id: `bad_request` / `not_found`
- the item is already in the requested state: `changed = false` and **no log
  row**, so the log only ever records real changes
- `p_expected_status` does not match the current row: `stale`, answered as 409,
  which is what stops two moderators fighting over one item
- on a real change: one row in `community_moderation_log`, and every open report
  against that item is marked `actioned`

`remove` also deletes the item's notification rows, so a removed post does not
keep ringing bells.

## 4. What a viewer sees

- Feed and thread views are filtered per viewer by SQL, not by the client: a
  `hidden` item is visible to its author and to staff, a `removed` item to staff
  only. Everyone else never receives the row.
- A hidden or removed post shows its author a banner: "Hidden by moderators" or
  "Removed: <reason>".
- A removed comment renders as a placeholder, so the replies under it still make
  sense.
- Staff see a Hidden/Removed badge and a Restore control in place, on the feed
  and on the post page.
- The Moderation link is decided on the server: it is in the markup only when
  the session is staff, so a guest never learns the URL exists.

## 5. Blocks

`/api/community/blocks` runs on the viewer's own session. RLS is the authority;
the route adds the rules RLS cannot express:

- you cannot block yourself (400)
- you cannot block a moderator: the answer is 403 with "use Report instead",
  because a block that hides staff is a way to make yourself unmoderatable
- the blocked person is never told

Blocking is enforced in SQL: `comment_feed` drops blocked authors for that
viewer, and `BEFORE INSERT` guards stop a blocked author's reply, mention or like
rows from being written at all. Filtering in the client only hides what the
server already removed; it is not the mechanism.

## 6. Rate limits

Two layers. Both are per instance unless stated, and the durable layer is the one
that matters.

| Action | In-process (fast) | Durable (SQL, survives restarts) |
| --- | --- | --- |
| Comment | 1 per 10 s | 5 per minute, 40 per hour |
| Post | 1 per 30 s | 3 per 10 minutes, 20 per day |
| Reaction | - | 60 per minute |
| Report | - | 10 per hour, per reporter |

Staff are exempt from the durable limits: a moderator clearing a queue should not
be told to slow down.

Refusals carry a stable code, so the UI never has to match on prose:
`rate_limit:comments_minute`, `rate_limit:comments_hour`,
`rate_limit:posts_10min`, `rate_limit:posts_day`,
`rate_limit:reactions_minute`, `rate_limit:reports_hour`.

## 7. Anti-spam

`app/lib/community/antispam.ts`, all thresholds from the environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMMUNITY_NEW_ACCOUNT_HOURS` | 24 | an account younger than this is "new" |
| `COMMUNITY_NEW_ACCOUNT_POSTS_PER_HOUR` | 3 | posts per hour for a new account |
| `COMMUNITY_NEW_ACCOUNT_MAX_LINKS` | 1 | links per post for a new account |
| `COMMUNITY_MAX_LINKS` | 2 | links per post, anyone |
| `COMMUNITY_DUPLICATE_WINDOW_MIN` | 10 | same author, same body, within this window is a 409 |

A duplicate body from a *different* author is logged, never refused: two people
can legitimately say "this episode was great".

## 8. Comment writes

Comments are written by the server, not the browser: `POST /api/comments`,
`PATCH /api/comments/<id>` (spoiler flag), `DELETE /api/comments/<id>` (soft
delete). Each one checks the session, validates the shape, refuses profanity
server-side, and writes with the service role. Because the service role is not
RLS, ownership is in the filter: every update and delete carries
`user_id = <session user>` and answers 404 on a miss, so someone else's comment
is never confirmed to exist.

The browser never sends `user_id`. A test asserts that.

## 9. Account deletion

`app/lib/account/deletion.ts` holds the list and the order; the route is wiring.

| Data | What happens |
| --- | --- |
| Comments | `anonymise_user_comments`: a comment with replies stays, `user_id` null, body `[deleted]`; one without replies is deleted |
| Favourites, watchlist, progress, comment reactions | deleted |
| Community posts, reactions, blocks (both directions), `staff_roles` | deleted |
| Clips | deleted - `clips.user_id` is `SET NULL`, so leaving them would keep the author's name and avatar on a public row |
| Own reports | deleted by the anonymiser |
| Other people's reports, including about their content | kept, `reporter_id` / `resolved_by` nulled |
| Moderation log | kept, `actor_id` nulled |
| `user_notifications`, `push_outbox` | cascaded by the auth delete |
| OneSignal | subscription deleted by `external_id` before the auth delete; best effort, never blocks |

## 10. SQL, in this order

Two steps, and the order is not optional.

**Step 1, before deploying the new code:**

```
docs/sql/community-phase-6.sql
```

Additive only: new columns with defaults, new tables, new functions, new
policies. The old deployment keeps working while it runs, which is the point -
nobody is locked out while the code is still the previous version.

**Step 2, only after the new code is live and you have clicked through
`/community/admin` once:**

```
docs/sql/community-phase-6-lockdown.sql
```

This drops the browser's `comments insert own` policy and revokes `INSERT`,
`UPDATE` and `DELETE` on `public.comments` from `anon` and `authenticated`.
Running it before the deploy breaks comment posting for every visitor, because
the new API is not there yet.

**Rollbacks, in the reverse order:**

```
docs/sql/community-phase-6-lockdown.rollback.sql   -- restores the Phase 5 grants
docs/sql/community-phase-6.rollback.sql            -- restores the Phase 5 functions
```

Both are written to be run on their own, without a redeploy. The Phase 6
rollback refuses while moderated rows exist: it will not silently un-hide
content somebody hid on purpose.

**Verification, after step 1:**

```sql
select proname from pg_proc
 where proname in ('community_moderate','community_moderation_stats',
                   'community_report_groups','community_clip_report_groups',
                   'community_moderation_queue');
-- expect 5

select table_name, string_agg(column_name, ', ' order by column_name) as columns
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('comments','announcements','community_posts','clips')
   and column_name in ('status','removed_reason','moderated_at','moderated_by','hidden_at')
 group by table_name order by table_name;

-- expect exactly these four rows:
--   announcements      moderated_at, moderated_by, removed_reason, status
--   clips              hidden_at, moderated_at, moderated_by
--   comments           moderated_at, moderated_by, removed_reason, status
--   community_posts    moderated_at, moderated_by
```

**Verification, after step 2:**

```sql
select has_table_privilege('authenticated','public.comments','INSERT');  -- false
select has_table_privilege('authenticated','public.comments','SELECT');  -- true
select policyname from pg_policies
 where tablename = 'comments' and cmd = 'INSERT';                        -- none
```

## 11. Environment variables

| Variable | Needed for | Default if unset |
| --- | --- | --- |
| `COMMUNITY_ENABLED` | the whole feature | off (404) |
| `COMMUNITY_TOASTS` | the new-post toast | off |
| `COMMUNITY_POLL_SECONDS` | the bar's polling interval | 30 |
| `CLIPS_PUBLIC_ENABLED` | the public clip list | off |
| `COMMUNITY_NEW_ACCOUNT_HOURS` | anti-spam | 24 |
| `COMMUNITY_NEW_ACCOUNT_POSTS_PER_HOUR` | anti-spam | 3 |
| `COMMUNITY_NEW_ACCOUNT_MAX_LINKS` | anti-spam | 1 |
| `COMMUNITY_MAX_LINKS` | anti-spam | 2 |
| `COMMUNITY_DUPLICATE_WINDOW_MIN` | anti-spam | 10 |
| `NEXT_PUBLIC_ONESIGNAL_APP_ID` | push, and its removal on deletion | push off |
| `ONESIGNAL_REST_API_KEY` | sending push, and its removal | push off |

No new variable is required to deploy Phase 6. The five anti-spam values and the
two OneSignal values already existed; Phase 6 only reads them.

## 12. Screenshots and the keyboard pass

`test-harness/community-e2e/phase6-shots.mjs` photographs the dashboard, inbox,
clip reports and log at 360, 768 and 1280, then walks the tab order to the
Restore control and fires it with Enter. The two-step confirm is part of the
path on purpose: Enter on Restore opens the confirm, Tab and Enter commits it.

Regenerate:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=standin-anon-key npx next build

STUB_PORT=54329 node test-harness/community-e2e/stub.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=standin-anon-key \
SUPABASE_SERVICE_ROLE_KEY=standin-service-key COMMUNITY_ENABLED=1 \
npx next start -p 3100 &

node test-harness/community-e2e/phase6-shots.mjs
```

The last run: 12 screenshots, all HTTP 200, keyboard path clean, one `POST`
fired on Enter.

## 13. Bundle impact

From `next build` with the stub environment:

| Route | Page | First load |
| --- | --- | --- |
| `/community` | 18.6 kB | 267 kB |
| `/community/admin` | 2.53 kB | 99.3 kB |
| `/community/admin/reports` | 2.53 kB | 99.3 kB |
| `/community/admin/reports/[key]` | 2.53 kB | 99.3 kB |
| `/community/admin/clips` | 2.53 kB | 99.3 kB |
| `/community/admin/hidden` | 2.53 kB | 99.3 kB |
| `/community/admin/log` | 847 B | 97.6 kB |
| `/api/comments`, `/api/comments/[id]`, `/api/account/delete` | 0 B | 0 B |

Shared first load is 88 kB. The admin pages are small because they are server
components: no moderation state ships to the browser except the confirm row's
own. Nothing in Phase 6 is added to the watch page or the feed's client bundle;
`/community` is unchanged from Phase 5.

## 14. What could not be verified from here

- **A real Supabase project.** Every SQL claim is proved against PGlite, a real
  Postgres with the Supabase roles, functions and policies created by the
  migration files. What is *not* proved is the same thing against the production
  database with its actual data volume.
- **OneSignal.** The request shape is asserted against a fake `fetch`; no real
  app id was used, so the live endpoint is unproven.
- **Cloudflare.** Rate limits are per instance, and the number of instances
  behind the proxy is not something this repository can see.
- **Email or push delivery on removal.** A removed post's notifications are
  deleted, but nothing recalls a push that already went out.
