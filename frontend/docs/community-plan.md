# Prompt 38A - Community: plan only

> **Status:** plan. No application code is written or changed by this prompt.
> The only file this branch adds is this document.
>
> **Branch:** `plan-community`, cut from `master` at `e66a034`
> ("Merge pull request #84 from wisdom-technologies-bit/ani-provider"), which
> already contains the merged clip pages (Prompt 36, `f7f85c2` / PR #83) and the
> ani provider (Prompt 37, PR #84). OtakuNaija is not touched.

Everything below was read from the repository, not assumed. Where a claim is an
inference rather than a reading, it says so.

---

## 0. How to read this document

The owner's brief is kept intact in intent. Sections 1-7 are findings and
design; section 8 is an explicit numbered list of open questions, each with a
recommended default, so the answer "yes to all defaults" is enough to start
Phase 38B.

Build order is in **section 6** (phases 1-6). Phase 1 is the smallest shippable
slice: data model, posts, announcements page, bell link and footer link.

---

## 1. Findings

### 1.1 Comments

**Tables** (from `supabase/migrations/20261023000000_core.sql`, one line each,
reformatted):

```sql
create table public.comments(
  id uuid primary key default gen_random_uuid(),
  anilist_id bigint not null,
  episode_number int,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 2000),
  is_spoiler boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.comment_reactions(
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check(value in (1,-1)),
  created_at timestamptz not null default now(),
  primary key(comment_id,user_id)
);
```

`public.public_profiles` is a view: `select id, username, display_name,
avatar_url from public.profiles`, granted to `anon, authenticated`.

**Migrations read**

| File | What it adds |
| --- | --- |
| `20261023000000_core.sql` | `comments`, `comment_reactions`, `public_profiles`, base indexes |
| `20261027000100_prompt10_comments.sql` | RLS, `comment_feed` view, `comments_guard()` trigger, indexes |
| `20261027000000_prompt9_user_data.sql` | `notifications`, `notification_subscriptions`, episode fanout |
| `20261101000000_prompt21_push.sql` | `push_preferences`, `push_outbox`, `user_notifications`, `announcements`, `announcement_reads`, reply/like/mention triggers |
| `20261024000000_queue_functions.sql`, `202610240001_provider_health.sql`, `202610240002_skip_times.sql`, `20261028000000_prompt12_manga.sql`, `20261108000000_prompt25_logos.sql` | unrelated |

Clips are **not** in `supabase/migrations`; their schema lives in
`docs/sql/clips.sql` (applied by hand in the SQL editor).

**`comment_feed` view** - exactly as defined today:

```sql
create or replace view public.comment_feed as
select c.id, c.anilist_id, c.episode_number, c.parent_id, c.user_id, c.body,
       c.is_spoiler, c.created_at, p.username, p.display_name, p.avatar_url,
       coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int as likes,
       coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int as dislikes
from public.comments c
left join public.public_profiles p on p.id = c.user_id
left join public.comment_reactions r on r.comment_id = c.id
where c.deleted_at is null
group by c.id, p.username, p.display_name, p.avatar_url;
grant select on public.comment_feed to anon, authenticated;
```

Three things matter for a feed and are worth stating plainly:

1. It is a **plain (owner-rights) view**. It does not run as the caller, so the
   `comments` RLS policies are not what makes it safe; its own `where
   deleted_at is null` is. That is fine for public comments, but it means a feed
   view built the same way must encode every privacy rule in its own `WHERE`.
2. It **shows replies** (`parent_id` is not null rows are returned) and has no
   `parent_id is null` filter. Feed code must add `.is("parent_id", null)`.
3. It has **no `anime` join**, so it carries no title, cover or `is_adult`.

**RLS policies on `comments`** (`20261027000100_prompt10_comments.sql`):

- select to `anon, authenticated`: `using (deleted_at is null or auth.uid() = user_id)`
- insert to `authenticated`: `with check (auth.uid() = user_id)`
- update to `authenticated`: `using (auth.uid() = user_id) with check (auth.uid() = user_id)`
- **no delete policy** - deletes are impossible for clients; deletion is
  `update comments set deleted_at = now()`, and the guard allows it because it
  only freezes the other columns.

`comment_reactions` is `select/insert/update/delete` restricted to
`auth.uid() = user_id`. Consequence: a client cannot count other people's
reactions directly; counts only come from `comment_feed` (or from a security
definer function). Any new feed/reaction surface must respect that.

**`comments_guard()` trigger** (before insert or update):

- insert: refuses if the same `user_id` inserted a comment in the last 10
  seconds (site-wide, not per target) with the message
  `You are commenting too fast. Please wait a few seconds.`; refuses a
  `parent_id` unless the parent is top-level, same `anilist_id`, and not deleted.
- update: freezes `user_id`, `anilist_id`, `episode_number`, `parent_id`, `body`,
  `created_at`, and stamps `updated_at = now()`.

**Two real inconsistencies to fix while building:**

1. **The 400-character limit is client-only.** `COMMENT_BODY_LIMIT = 400` lives
   in `app/lib/comments/queries.ts`; the database allows **2000**. Anything that
   calls PostgREST directly (or the new community API) can post 2000 characters.
   The plan pads this with a server-side check *and* a database check for the new
   post-comment path (see 2.4).
2. **The profanity filter is client-only.** `normaliseCommentBody()` runs
   `new Filter()` from `bad-words` in the browser bundle. A direct call bypasses
   it. Posts will be filtered server-side (see 3.2); retrofitting comments is
   Phase 6.

**Comment UI**

- `app/components/CommentsSection/index.tsx` - one component for both pages.
  `COMMENTS_PAGE_SIZE = 20`, sorts `recent | oldest | likes | dislikes`
  (`SORT_OPTIONS` in `queries.ts`), an episode picker (`ALL_EPISODES` plus one
  entry per commented episode), one level of replies, per-comment spoiler reveal,
  "show more comments" growth by page size.
- `app/components/CommentsSection/components/CommentContainer/index.tsx` renders
  the row with `data-comment-id={comment.id}` and `data-testid="comment-<id>"`.
  **There is no DOM `id` on a comment**, so `#comment-<uuid>` deep links do not
  work yet. Phase 2 adds `id={"comment-" + comment.id}`.
- Mount points: `app/media/[id]/page.tsx` (line ~354, under an `id="comments"`
  heading inside a `<section>`), and `app/watch/[id]/page.tsx` (line ~403, inside
  `<div id={styles.comments_zone}>`, keyed `comments-${ep}` so `?ep=` remounts).
- Mentions: `app/lib/comments/mentions.ts`, matching the SQL trigger
  `@[A-Za-z0-9_.-]{3,30}`, max 10 notifications per comment; the picker queries
  `GET /api/users/search?q=` (`app/api/users/search/route.ts` ->
  `app/lib/users/search.ts`).

**How a feed can read every comment on every anime/episode efficiently**

- **Read from `comments` joined to `anime`, not from `comment_feed`.** The feed
  needs `anime.title/cover_url/is_adult`, which `comment_feed` lacks, and it needs
  a `created_at`-ordered index that does not exist. Joining `comment_feed` per
  page would also run its `group by` over the whole visible slice.
- **New index is mandatory:** today the only indexes are
  `comments_media_idx (anilist_id, episode_number, created_at desc)` and
  `comments_parent_idx (parent_id)`. A global "newest first" scan has no usable
  index. Add a partial index on `(created_at desc, id)` `where deleted_at is null
  and parent_id is null` (partial = only top-level, live rows; small and hot).
- **Cursor, never offset.** Keyset on `(created_at, id)`; `OFFSET` degrades and
  skips rows when new comments arrive between pages, which is exactly what a live
  feed does.
- **Join `anime`** by `anilist_id` for `title`, `cover_url`, `is_adult`. `anime`
  has no RLS enabled and a primary key on `anilist_id`, so this is a cheap
  primary-key lookup.
- **Privacy of adult/hidden titles:** exclude a comment when
  `coalesce(a.is_adult, false)` is true and the viewer's adult setting is off
  (`app/lib/anilist/adult-content.ts`: profile `show_adult`, else the
  `is_adult_content_enabled` cookie, default hidden). The feed must apply the same
  rule as the rest of the site or it becomes a bypass around the adult gate.
- **Hiding spoilers:** the row carries `is_spoiler`. The *text* must not be sent
  to a client that has not asked for it if we want a real guarantee; pragmatically
  the existing site already sends spoiler text and blurs it in CSS
  (`CommentContainer` has a reveal control). Recommendation: the feed **does not
  include the body of spoiler comments**; it sends a `spoiler: true` placeholder
  and the standalone thread shows the real text after a reveal, matching the
  existing behaviour on the thread page. This is stricter than today and cheap.
- **Deleted rows:** `where c.deleted_at is null`, unconditionally.
- **Replies:** the feed shows **top-level comments only** (`parent_id is null`).
  A reply as a feed card would duplicate the thread and break the "open the
  original thread" affordance. The card shows a reply count instead (see 5.3).

### 1.2 Notifications and announcements

**Tables** (`20261101000000_prompt21_push.sql`):

```sql
create table public.announcements(
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  url text,
  image text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  push_sent_at timestamptz
);

create table public.announcement_reads(
  user_id uuid not null references auth.users(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(user_id, announcement_id)
);
```

Related: `notification_subscriptions(user_id, anilist_id, snapshot, created_at)`,
`notifications(id, user_id, anilist_id, episode, title, cover_url, created_at,
read_at, unique(user_id,anilist_id,episode))`, `push_preferences(user_id,
enabled, defaults_applied, new_episodes_all, new_episodes_subscribed, replies,
likes, mentions, announcements, digest_last_sent_at, updated_at)`,
`push_outbox(...)`, `user_notifications(id, user_id, kind check in
('reply','like','mention','digest'), title, body, url, image, actor_name,
actor_avatar, comment_id, count, created_at, read_at)`.

**Announcement RLS today:**

```sql
alter table public.announcements enable row level security;
create policy "announcements read" on public.announcements
  for select to authenticated using (expires_at is null or expires_at > now());
```

Two consequences:

- **`anon` cannot read announcements at all.** The bell only runs for signed-in
  users (`loadBell` returns early without a user), so nobody noticed. A public
  `/community` feed that shows announcements to visitors needs a policy for
  `anon` (see 2.2), otherwise the feed silently loses a whole card type for
  guests.
- There is **no insert/update/delete policy**, so announcements can only be
  created with the service role. The migration says so in a comment:
  *"announcements (you add rows in the Table Editor)"*. **There is no admin
  tooling**: no UI, no route, no role. Creating an announcement today is a SQL
  editor / Table Editor action by the owner.

**Bell read path** (`app/lib/user-data/notifications.ts`):

- `loadBell()` runs three reads in parallel: `listNotifications()` (episode rows),
  `listUserNotifications()`, `listAnnouncements()`, then `mergeBellItems()`
  (newest first, `BELL_ITEM_LIMIT = 50`) and `countBellUnread()`.
- `listAnnouncements()` reads `announcements` (limit 50, newest first), filters
  `isAnnouncementVisible()` client-side, then reads the user's
  `announcement_reads` rows and maps to `AnnouncementView`.
- `AnnouncementView` (line ~295):

```ts
export type AnnouncementView = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  image: string | null;
  isRead: boolean;
  createdAt: number;
};
```

- Read state: `markAnnouncementRead(id)` upserts into `announcement_reads`;
  `markAllBellRead()` marks everything, including every visible announcement.

**Bell UI** (`app/layout/header/components/Notifications/index.tsx`):

- `AnnouncementItem` renders a megaphone, `title`, unread dot, `body`, the
  optional `image` (`next/image`, `fill`, `sizes="240px"`) and - **only when
  `announcement.url` is set** - a `Link` labelled `Open`:

```tsx
{announcement.url && (
  <Link className={styles.watch_link} href={announcement.url}>Open</Link>
)}
```

So the change for requirement E is small and precise: render `Open`
unconditionally, pointing at `/community/announcements/{id}` (keep `url` as a
secondary "Visit link" when present), and call `markAnnouncementRead(id)` on
click. The panel is a dropdown above 640 px and a sheet below it
(`NOTIFICATIONS_SHEET_QUERY = "(max-width: 640px)"`).

**Which model? `community_posts.type in ('post','announcement')`, or a union?**

Recommendation: **keep `announcements` as it is** and build the feed as a union
of three sources (posts, comments, announcements). Reasons, in order of weight:

1. *One source of truth.* The brief says the bell and `/community` must show the
   same item. If announcements become `community_posts` rows, the bell, its RLS,
   `announcement_reads`, `AnnouncementView` and the push cron all have to be
   repointed, and a failed migration leaves two half-truths. If they stay, the
   bell and the feed literally read the same row.
2. *No backfill, no data loss risk.* Zero rows to copy. The only backfill needed
   is none at all.
3. *Creation stays an owner-only SQL action for now* (which is what "who can
   create them: admin tooling? SQL only?" found), and Phase 6 adds a tiny
   protected route that writes the same table.
4. *Cost of the union is negligible* - see the numbers in 1.5 and 5.1.

What it costs: `community_posts` and `announcements` have slightly different
columns (`expires_at`, `url`, `image`), so the feed's `announcement` branch maps
them into the common shape (SQL in 2.6). That mapping is five lines.

**Materialised feed table vs union view/RPC** (the brief asks to compare)

| | Materialised `community_feed` filled by triggers | Union + cursor RPC (recommended) |
| --- | --- | --- |
| Read cost per page | one index scan, `O(limit)` | three index scans of `<= limit` rows + a sort of `<= 3*limit` rows |
| Consistency | eventual; needs triggers on posts, comments and announcements; edits and soft deletes need three more trigger branches | exact, always; the row *is* the source row |
| Body text duplication | yes; spoiler reveal and soft delete must be mirrored in the feed table | none |
| Write amplification | every comment insert/delete now writes twice | none |
| RLS | feed table needs its own policies, and they can drift from the source tables | the RPC encodes the rules once |
| Backfill | full historical backfill of `comments` (potentially large) | nothing |
| Failure modes | a missed trigger silently drops a post from the feed | a slow query, bounded by the index |
| Correctness of the merge | trivial (single ordered table) | **correct by construction**: the k-way merge in 2.6 is right because a source's row beyond its first `limit` can never be in the global top `limit` |

A materialised table pays off at tens of millions of rows and a read/write ratio
near 1000:1. This site is nowhere near that, and comments are the opposite
(one row per user action, read by everybody). **Union RPC wins.**

The one thing the union cannot do cheaply is a *global* "count of items", which
nobody needs: the "N new posts" counter is a separate cheap query (2.6,
`community_new_since`).

### 1.3 Clips

**Tables** (`docs/sql/clips.sql` - *not* in `supabase/migrations`, applied by
hand):

```sql
create table public.clips(
  id uuid primary key default gen_random_uuid(),
  code text not null,
  anilist_id bigint not null references public.anime(anilist_id) on delete cascade,
  episode_number int not null,
  start_seconds numeric(8,2) not null,
  end_seconds numeric(8,2) not null,
  title text,
  user_id uuid null references auth.users(id) on delete set null,
  owner_token_hash text null,
  source_audio text null,
  views int not null default 0,
  created_at timestamptz default now(),
  deleted_at timestamptz null,
  constraint clips_range_order check (end_seconds > start_seconds),
  constraint clips_range_length check (end_seconds - start_seconds <= 120),
  constraint clips_range_start check (start_seconds >= 0),
  constraint clips_episode_positive check (episode_number > 0),
  constraint clips_views_positive check (views >= 0),
  constraint clips_source_audio check (source_audio is null or source_audio in ('sub','dub'))
);

create table public.clip_reports(
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  reason text not null,
  details text null,
  reporter_hash text null,
  created_at timestamptz not null default now(),
  constraint clip_reports_reason check (reason in ('copyright','broken','inappropriate','spam','other'))
);
```

Indexes: `clips_code_key` (unique), `clips_user_created_idx (user_id,
created_at desc)`, `clips_anime_episode_idx (anilist_id, episode_number)`,
`clip_reports_clip_idx (clip_id, created_at desc)`.

**The shape of the feature:** a clip is a *pointer* to a time range, never a
file. `/clip/{code}` or `/watch/{id}?ep={n}&t={start}&end={end}`. Nothing is cut,
uploaded or hosted. This matters for the community: attaching a clip to a post is
attaching a **`clips.id`**, not media.

**Library and routes**

| Path | What it does |
| --- | --- |
| `app/lib/clips/constants.ts` | every limit: `CLIP_MIN_SECONDS 3`, `CLIP_MAX_SECONDS_GUEST 60`, `CLIP_MAX_SECONDS_USER 120`, `CLIP_TITLE_MAX_LENGTH 80`, `CLIP_CODE_ALPHABET`, `CLIP_CODE_LENGTH 7`, `CLIP_OWNER_COOKIE "kumori_clip_owner"`, `CLIP_OWNER_COOKIE_MAX_AGE 30d`, `CLIP_RATE_GUEST 10/h`, `CLIP_RATE_USER 60/h`, `CLIP_REPORT_RATE 5`, `CLIPS_PAGE_SIZE 50`, `clipPath()`, `watchPath()` |
| `app/lib/clips/code.ts` | `isClipCode()`, generator |
| `app/lib/clips/owner-token.ts` | `createOwnerToken()` (32 random bytes, base64url), `hashOwnerToken(token, CLIP_OWNER_SECRET)` (HMAC-SHA256 when the secret is set, plain SHA-256 otherwise), `ownerTokenMatches()` (constant time), `hashIdentifier()` |
| `app/lib/clips/server.ts` | `getClipByCode`, `getAnimeSummary`, `getAnimeSummaries(ids)` (one query for a page), `createClipRecord`, `canManageClip`/`ownsClip`, `deleteClip` (soft), `renameClip`, `incrementClipViews` (RPC), `reportClip`, **`listUserClips(userId)`** |
| `app/lib/clips/request.ts` | `readClipViewer()` (session user id or null), `clientIp(request)`, `readOwnerCookie()` |
| `app/lib/clips/rate-limit.ts` | `createRateLimiter({windowMs, maxKeys})`, in-memory sliding window, `clipCreationLimiter`, `rateLimitKey()` |
| `app/lib/clips/body.ts`, `range.ts`, `time.ts`, `title.ts`, `url.ts`, `views.ts` | validation, formatting, URL parsing |
| `app/api/clips/route.ts` | `POST` create (guest cookie or session; 201 `{clip, url, owner}`) |
| `app/api/clips/[code]/route.ts` | `GET` -> `{clip, canManage}`, `PATCH` rename, `DELETE` soft delete |
| `app/api/clips/[code]/report/route.ts` | `POST` report -> `clip_reports` |
| `app/api/clips/[code]/view/route.ts` | `POST` counts a view once per session cookie |
| `app/clip/[code]/page.tsx` | the clip page (`generateMetadata`: `robots: {index:false, follow:true}`, OG `video.other`, `ogImageUrl(anilistId, episode)`, adult hidden -> no image) |
| `app/clips/page.tsx` | **"My Clips"**, `dynamic = "force-dynamic"`, `robots: {index:false}`; guests get `SignedOutPrompt` |
| `app/clips/components/MyClipsList` | copy link, rename, delete |
| `app/watch/[id]/components/ClipBridge` | provider + `ClipPanel` + the one status toast (`TOAST_MS = 3200`) |

**Ownership: token vs user id** - `clips.user_id` is set only for a signed-in
creator; a guest gets `owner_token_hash` (SHA-256/HMAC of an HttpOnly cookie) and
`user_id` stays null. `ownsClip()` accepts a session match, or (only when the row
has no `user_id`) a guest cookie hash match.

**This is the blocker for the "my recent clips" picker:** `listUserClips(userId)`
is the only listing function and it filters `user_id`, so **a guest cannot list
their own clips at all** - `/clips` shows them a sign-out prompt. The picker needs
a second query:

```ts
// Phase 3: same shape, keyed on the guest cookie instead of the session.
listClipsByOwnerHash(ownerHash: string, limit = 20)
// select ... from clips where owner_token_hash = $1 and deleted_at is null
// order by created_at desc limit $2
```

served by a new `GET /api/clips/mine` that answers for **both** identities
(session first, then owner cookie) so the picker has one call.

**Thumbnails without video decoding** - already solved, reuse it:

`app/thumb/[id]/[ep]/route.ts` -> `app/lib/seo/thumb.ts` re-serves an episode
image **from our own origin**. Source order is our database only
(`episodes.image_url` -> `anime.banner_url` -> `anime.cover_url`), every upstream
hop is https-only with a DNS check against private ranges *on each redirect*, a
12 s total budget, 5 s per hop, 3 MB cap, no cookie/header forwarding, and
`cache-control: public, max-age=86400, s-maxage=2592000,
stale-while-revalidate=604800`. When everything fails it returns the existing OG
card, so the URL always answers with an image.

So a clip card's poster is **`/thumb/{anilist_id}/{episode_number}`** - no
frame extraction, no ffmpeg, no bucket. `app/clips/page.tsx` already builds
exactly that string. A clip's stored `start_seconds` is *not* used for the poster;
making a frame at `t=` would need server-side decoding, which we are explicitly
not doing.

### 1.4 Auth, roles and moderation

**Identity.** `app/lib/supabase/AuthProvider.tsx` exposes
`useUser() -> { user, profile, isAnonymous, loading, signOut }`, reads the
`profiles` row with `select("*")`, and subscribes to `auth.onAuthStateChange`.
Clients: `app/lib/supabase/browser.ts` (singleton `createBrowserClient` with the
anon key), `server.ts`, `auth-server.ts`, `admin.ts`
(`createAdminClient()` with `SUPABASE_SERVICE_ROLE_KEY`, `server-only`).

**Anonymous users are real.** `app/components/UserLoginModal/index.tsx` calls
`client.auth.signInAnonymously()`, so a visitor can hold a genuine
`auth.users` row marked `is_anonymous`, and `AuthProvider.isAnonymous` exposes it.
`/api/account/delete` refuses anonymous users. This matters for every community
rule that says "must be signed in": an anonymous Supabase user *is* signed in as
far as RLS is concerned.

**Roles: there are none.** `profiles` (core.sql) is
`id, username, display_name, avatar_url, title_language, show_adult,
subtitle_language, preferred_audio, auto_next, auto_skip, video_quality,
created_at, updated_at`. No `role`, no `is_admin`, no `admins` table. There is no
admin area: the only route under `app/api/admin/` is `ani-status/route.ts`, and it
authenticates with `requireCron(request)` from `app/lib/cron/auth.ts`
(`x-cron-secret: $CRON_SECRET`, or a bearer token). That is the whole admin
mechanism in this repository - server-to-server, no human login.

**Report flow that exists:** `app/clip/[code]/components/ReportClip/index.tsx` -
a pill that opens a small form (`copyright`, broken, inappropriate, spam, other +
free text), posts to `/api/clips/{code}/report`, always offers
`LEGAL_CONTACT_EMAIL` as a fallback, and states "sent" or "error". It is a good
pattern to copy for posts and comments.

**Rate-limit helpers that exist:** `app/lib/clips/rate-limit.ts`,
`createRateLimiter()` - a sliding window in a module-level `Map`, `maxKeys 5000`
LRU-ish eviction, pure `check(key, limit, now)`. **It is per process.** On
serverless/edge (Vercel) each instance has its own map, so the effective limit is
`limit × instances` and it resets on cold start. It is a speed bump, not a
guarantee. The durable rate limit in this repo is the one in
`comments_guard()` (10 seconds between comments), because it lives in the
database.

**Recommendation for admin moderation (minimal, honest):**

1. Add `profiles.role text not null default 'user' check (role in ('user','moderator','admin'))`.
   Managed by SQL only for now (`update public.profiles set role='admin' where id='<uuid>'`).
   No UI to grant it, which is the point: an escalation bug cannot create admins.
2. Add `public.is_staff()` - `security definer`, `stable`, returns true when
   `auth.uid()` has role in (`moderator`,`admin`). Used by RLS policies
   (`... or public.is_staff()`) and by the new admin route.
3. Add `public.is_admin()` for the destructive set (delete other people's
   content, create announcements).
4. One tiny route, `POST /api/community/admin/*`, authenticated by
   `is_admin()` **from the session cookie**, not by `CRON_SECRET`. `CRON_SECRET`
   stays for cron only - it is a shared secret in a header, it must never be
   handed to a browser, and it cannot express "who did this".
5. Every moderation action writes `community_moderation_log`
   (`actor_id, action, target_kind, target_id, reason, created_at`) so a removal
   is explainable later. Cheap, and the reports table needs somewhere to point.

### 1.5 Realtime

**What the repo does today: nothing.** `grep -rn "realtime|channel(" app`
returns exactly one hit, inside a test harness comment
(`app/lib/ani/__tests__/watch-harness.ts:41`, "node version. The watch route never
uses realtime, so an inert stub is"). Browser client:
`createBrowserClient` from `@supabase/ssr` (`app/lib/supabase/browser.ts`),
`@supabase/supabase-js ^2.118.0`. **The bell does not use realtime either**: it
polls on mount, on window focus and every 5 minutes.

**The plan constraint is not visible in the repo.** There is no
`supabase/config.toml`, no plan file, no CI config naming a Supabase tier. So the
connection/message numbers below come from Supabase's published limits and must be
checked against the project's actual plan before Phase 4 (open question 12).
As published at the time of writing: Free = 200 concurrent Realtime connections
and 2 million Realtime messages/month; Pro = 500 concurrent and 5 million
messages/month. Realtime also requires the table to be added to the
`supabase_realtime` publication and requires a **Realtime Authorization** policy
for `postgres_changes` on RLS-protected tables, otherwise subscribers receive
nothing.

**Three options, with numbers**

Assume 500 concurrent readers at peak, each open for 10 minutes, with a post
every ~2 minutes site-wide.

**(a) Realtime `postgres_changes` on `community_posts`, filtered to public rows**

- Connections: one websocket per open tab, 500 at peak, 501 with a second tab in
  the same browser (the JS client does not multiplex tabs by default). Free plan
  cannot hold that (200 cap): the 201st tab fails to subscribe, and the failure is
  a silent disconnect, which is worse than no feature.
- Messages: every subscriber receives every INSERT. 30 posts/hour × 500
  subscribers = 15 000 messages/hour = ~11 M/month, which is **5× over** the Pro
  allowance and 5.5× over Free.
- Latency: ~100-300 ms. That is its only advantage over polling at 30 s.
- Also needs: publication membership, a Realtime Authorization policy mirroring
  the feed rules, and unsubscription on route change (the bell's "5-minute poll"
  pattern shows how easy it is to leak a subscription here).

**(b) Polling `GET /api/community/latest?after=<cursor>` every 30 s**

- Requests: 600/hour per open tab. With 500 concurrent readers that is 83 req/s,
  which a single Node/Postgres pair handles comfortably for a query that returns
  at most a handful of rows (index-only on `(created_at desc, id)`).
- Cost control: the response is `ETag: W/"<count>-<newest_created_at>"` and
  `Cache-Control: no-store` with a conditional `If-None-Match`; when nothing is
  new the answer is **`304` with an empty body**, so the steady state is a
  ~200-byte request and a zero-row query. That is ~1.7 M requests/month, of which
  the vast majority are 304s.
- Pause: `visibilitychange` -> hidden stops the timer and clears it; returning to
  the tab does one immediate poll. A tab in another tab costs nothing.
- Anonymous visitors: works unchanged (the endpoint is public, read-only, and
  carries nothing user-specific), which is exactly what the brief asks for.
- Latency: up to 30 s. For a "new post" bar on a small site this is acceptable,
  and the requirement's own throttle (never more than 1 toast per 10 s) means
  sub-second latency would be thrown away anyway.

**(c) Both, with Realtime as an enhancement**

- Correct, but it is two delivery paths to test, two sets of rules to keep in
  sync, and the Realtime path is the one that silently fails when the plan's
  connection ceiling is hit. Not worth it for a feature whose own spec caps
  notifications at one per 10 seconds.

**Recommendation: (b), polling with ETag, `visibilitychange` pause, and a 10 s
toast throttle on top.** Realtime is kept as a documented future swap behind the
same `CommunityNewPostSource` interface (one module,
`app/lib/community/live.ts`, exporting `subscribe(cb): () => void`), so switching
later is one file. Revisit when the project holds a plan with ≥ 500 concurrent
connections *and* the site actually has concurrent readers in the hundreds.

**Anonymous visitors** poll the same endpoint with the same 30 s cadence. To stop
a public endpoint being used as a free scraping service, it returns **only**
`{ id, created_at, author_name, snippet (<= 120 chars), has_clip, clip_code }` -
no full bodies, no emails - and is rate limited per IP (see 3.4).

### 1.6 Header, footer, layout

- **Header:** `app/layout/header/index.tsx`, styles in
  `app/layout/header/headerComponent.module.css`. Requirements say the community
  link goes in the **footer only**, so nothing changes here except the bell item
  (`app/layout/header/components/Notifications/index.tsx`). There is currently no
  Community entry in the desktop nav (`Animes`, `Mangas`, search, user, bell).
- **Footer Explore column:** `app/layout/footer/components/navLinks/index.tsx`,
  the `<div id={styles.div_custom_margin}>` block headed `<h5>Explore</h5>` with
  Home / Release Schedule / Search Anime / Search Manga. The new link goes there
  as the third item (`/community`, label `Community`), above "Search Manga" or
  right after Home. **Nothing in the header.**
- **Root layout:** `app/layout.tsx` - `<html lang="en">`, `<body>` ->
  `<StoreProvider>` -> `<AuthProvider>` -> `<PushProvider />` -> `<Header />` ->
  `<NextTopLoader />` -> `{children}` -> `<Footer />`. A toast host mounted here
  is inside every provider (so it can call `useUser()`) and is a sibling of
  `{children}`, so it never re-renders page trees and never changes layout as long
  as it is `position: fixed`.
- **Page shells:** `WatchLayout` (`app/watch/[id]/components/WatchLayout/index.tsx`,
  grid in `app/watch/[id]/page.module.css`): one column, `minmax(0,1fr) 380px` at
  `min-width: 1024px`, `minmax(0,1fr) 400px` at `1536px`. Generic pages
  (`/clips`) use `#container { max-width: var(--max-width); padding: 24px
  var(--page-gutter) 64px }` in `app/clips/page.module.css`.
- **Breakpoints** (`app/globals.css`): tokens `--breakpoint-sm 576px`,
  `--breakpoint-md 768px`, `--breakpoint-lg 992px`, `--breakpoint-xl 1200px`,
  `--breakpoint-xxl 1440px`; `--max-width: 1380px`, `--page-max: 1760px`,
  `--page-gutter: clamp(16px, 2.4vw, 48px)`. CSS modules mostly hardcode the
  numbers in `@media` queries, so the community stylesheet will too (matching
  `app/clips/page.module.css`).
- **Stacking:** `--z-content 1`, `--z-sticky-subnav 20`, `--z-page-popover 30`,
  `--z-header 1000`, `--z-header-popover 1010`, `--z-scrim 1040`,
  `--z-scrim-player 1060`, `--z-modal 1100`, `--z-toast 1200`. The new-post bar
  uses **`--z-toast`** and sits below the header in the visual order the brief
  wants: top-centre under the header on desktop, top edge on mobile.
- **Fullscreen:** the player goes fullscreen via the vidstack player, so the
  suppression check is `document.fullscreenElement !== null` (plus the
  `fullscreenchange` event), not a route check. `/community*` is suppressed by
  `usePathname()`.
- **Existing toast precedent:** `app/watch/[id]/components/ClipBridge/index.tsx`
  (`TOAST_MS = 3200`, `position: fixed`, `--z-toast`). There is no shared toast
  component; the community bar is the second one, so it gets extracted properly
  (`app/components/CommunityToast/`) rather than copied.

### 1.7 SEO and safety

- `app/robots.ts` (one line): `userAgent: "*"`, `allow: "/"`, `disallow:
  ["/api/","/auth/"]`, `sitemap: ${site}/sitemap.xml`. Anything not under those
  two paths is crawlable by default, so **new community routes are indexable
  unless their metadata says otherwise.**
- `app/sitemap.xml` -> `app/sitemaps/[file]/route.ts` (`^(episodes|anime)-(\d+)\.xml$`
  only) and `app/sitemaps/static.xml/route.ts` -> `STATIC_SITEMAP_PAGES` in
  `lib/sitemap.ts` (`/`, `/schedule`, `/search`, `/search?type=manga`). Chunks are
  `unstable_cache`d (tag `sitemap`, `revalidate 3600`) with ETag/Last-Modified.
  **Impact:** adding per-post URLs would mean touching the strict filename
  parser, the index file count and the cache tags - i.e. thousands of volatile
  URLs would churn a cache that is currently cheap and stable. Plan: **do not add
  any per-post URL to the sitemap.** At most, one line in `STATIC_SITEMAP_PAGES`
  (`/community`, changefreq `hourly`, priority `0.6`) in Phase 4, behind the
  feature flag.
- **OG:** `ogImageUrl(id, episode)` -> `/og/{id}[/{ep}]` (`app/lib/seo/og-image.tsx`),
  and `app/og/[id]/` exists. Clip pages already build OG with `video.other` and
  suppress the image for adult titles when the setting is off
  (`app/clip/[code]/page.tsx`). Community reuses `ogImageUrl` for clip posts, and
  the site's static `/og-image.png` for text posts and announcements without an
  image.
- **Account deletion:** `app/api/account/delete/route.ts` loops
  `["favourites","watchlist","watch_progress","comments","comment_reactions"]`,
  deletes each `.eq("user_id", user.id)`, then `admin.auth.admin.deleteUser`.
  Note the existing side effect: `comments.parent_id ... on delete cascade` means
  **deleting a user also deletes every reply to their comments.** That is today's
  behaviour; the plan keeps it for comments and adds the new tables (2.8), and
  flags the cascade in the risks.
- **`profiles` has no RLS enabled.** Only `comments`, `comment_reactions`,
  `notifications*`, `push_*`, `announcements`, `announcement_reads`, `clips` and
  `clip_reports` are enabled. `profiles` relies on the `public_profiles` view for
  column privacy, but a client can `select * from profiles` (which is what
  `AuthProvider` does) and read every row's `show_adult`/`title_language`. No
  email is stored there, so this is a minor leak, but community makes profiles
  more visible. Recommendation: enable RLS on `profiles` with
  `select own` + `select` for the four public columns via the view only. See open
  question 14.
- **Content safety, concretely:** all user text is rendered as **text nodes**
  (React escapes), never `dangerouslySetInnerHTML`; `html-react-parser` exists in
  the repo for other things and must not be used for post bodies. Links are
  rendered by our own component that enforces `rel="noreferrer noopener nofollow
  ugc"` and `target="_blank"` only for external hosts, and rejects
  `javascript:`/`data:` schemes. Images are **only** resolved clip thumbnails
  (`/thumb/{id}/{ep}`, our origin) and our own CDN - no user-supplied image
  hotlinking, no arbitrary remote `<img>`. Link previews for arbitrary URLs are
  proposed as allow-listed, SSRF-guarded and opt-in only (3.5), copying
  `app/lib/seo/thumb.ts`.

---

## 2. Recommended data model

### 2.1 The shape, in one paragraph

`community_posts` holds **user posts only**. `announcements` stays exactly as it
is (one source of truth for the bell and the feed). Comments on posts and on
announcements **reuse `public.comments`** with a new `target_type` plus the two
target columns. Reactions on posts/announcements live in
`community_reactions`; reactions on comments keep using `comment_reactions`.
Reports go to `community_reports`; clip reports stay in `clip_reports`. One read
surface, `community_feed_page()`, merges posts + anime comments + announcements
with a keyset cursor.

### 2.2 Why reuse `comments` instead of `community_post_comments`

The existing `comments` table is not "the anime comment table"; it is the site's
comment machinery, and everything hangs off it:

| Already wired to `comments` | Reusing it | A second `community_comments` table |
| --- | --- | --- |
| `comment_reactions` (like/dislike) | free | duplicate table + RLS + upsert code |
| `notify_comment_reply()` | free, after a link fix | duplicate trigger |
| `notify_comment_mentions()` | free | duplicate trigger |
| `notify_comment_like()` | free | duplicate trigger |
| `notify_comment_reply` -> `user_notifications` -> bell | free | duplicate |
| push outbox (`reply`, `like`, `mention`) | free | duplicate |
| `comments_guard()` (10 s rate limit, valid reply target, frozen edits) | extend | duplicate |
| account deletion loop | free | one more entry, but also orphan risk |
| `comment_feed` view for thread reads | extend | duplicate view |
| `user_notifications.comment_id` | keeps working | separate column |

Duplicating that is roughly five triggers, two RLS blocks and a second bell
pipeline, for no gain. The cost of reuse is one `ALTER` on a live table, which is
small and reversible: the only structural change is dropping `not null` from
`anilist_id` (existing rows all satisfy the new check constraint, so adding it
validates instantly).

### 2.3 SQL - the whole migration, in order

> File: `supabase/migrations/20261120000000_prompt38_community.sql`.
> Everything is idempotent. **Run `docs/sql/clips.sql` first if `public.clips`
> does not exist yet** - `community_posts.clip_id` references it (it has been in
> production since Prompt 35, so this is only a note for a fresh environment).

```sql
-- =====================================================================
-- Prompt 38: community feed
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. staff roles (SQL-only management; no UI can grant this)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'user';

alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles
  add constraint profiles_role_chk check (role in ('user','moderator','admin'));

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role in ('moderator','admin')
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin'
  );
$$;

grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. community_posts
-- ---------------------------------------------------------------------
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  is_spoiler boolean not null default false,
  clip_id uuid references public.clips(id) on delete set null,
  link_url text,
  link_title text,
  link_image text,
  pinned boolean not null default false,
  status text not null default 'published'
    check (status in ('published','hidden','removed')),
  removed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- 1000 characters: two lines of a feed card is ~160; the ceiling is for
  -- people who actually have something to say, not for essays.
  constraint community_posts_body_len check (char_length(body) between 1 and 1000),
  -- one attachment, ever: a clip OR a link, never both (and a clip is a pointer)
  constraint community_posts_attachment_chk check (clip_id is null or link_url is null),
  -- only our own http(s) links, never javascript:/data:
  constraint community_posts_link_scheme check (
    link_url is null or link_url ~* '^https?://[a-z0-9.-]+'
  )
);

comment on column public.community_posts.clip_id is
  'Pointer to a clips row. A clip is a time range, never a file.';
comment on column public.community_posts.link_image is
  'Only a kumoritv.top / our-CDN URL, or a resolved clip thumbnail. Never a user-supplied remote image.';
comment on column public.community_posts.status is
  'published = visible; hidden = held back by staff; removed = taken down, row kept for the report trail.';

create index if not exists community_posts_feed_idx
  on public.community_posts (created_at desc, id)
  where deleted_at is null and status = 'published';
create index if not exists community_posts_author_idx
  on public.community_posts (author_id, created_at desc)
  where deleted_at is null;
create index if not exists community_posts_clip_idx
  on public.community_posts (clip_id)
  where clip_id is not null;

-- ---------------------------------------------------------------------
-- 2. comments: extend for posts and announcements
-- ---------------------------------------------------------------------
-- anilist_id becomes nullable, but only for the new target types; the
-- constraint below is what actually guarantees it for anime comments.
alter table public.comments alter column anilist_id drop not null;

alter table public.comments
  add column if not exists target_type text not null default 'anime',
  add column if not exists post_id uuid
    references public.community_posts(id) on delete cascade,
  add column if not exists announcement_id uuid
    references public.announcements(id) on delete cascade;

alter table public.comments drop constraint if exists comments_target_type_chk;
alter table public.comments
  add constraint comments_target_type_chk
  check (target_type in ('anime','post','announcement'));

-- Exactly one target per row. Two nullable columns (not one shared uuid) so
-- both foreign keys stay real: a single column cannot reference two tables.
alter table public.comments drop constraint if exists comments_target_chk;
alter table public.comments
  add constraint comments_target_chk check (
    case target_type
      when 'anime'        then anilist_id is not null and post_id is null and announcement_id is null
      when 'post'         then anilist_id is null and post_id is not null and announcement_id is null
      when 'announcement' then anilist_id is null and post_id is null and announcement_id is not null
      else false
    end
  );

-- The 400-character UI limit was never enforced by the database (the column
-- allows 2000). Anime comments keep 2000 for compatibility; community
-- comments get the real 400.
alter table public.comments drop constraint if exists comments_body_len_chk;
alter table public.comments
  add constraint comments_body_len_chk
  check (target_type = 'anime' or char_length(body) <= 400);

-- the feed's index: top-level, live comments, newest first
create index if not exists comments_community_feed_idx
  on public.comments (created_at desc, id)
  where deleted_at is null and parent_id is null and target_type = 'anime';
create index if not exists comments_post_idx
  on public.comments (post_id, created_at desc)
  where post_id is not null and deleted_at is null;
create index if not exists comments_announcement_idx
  on public.comments (announcement_id, created_at desc)
  where announcement_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------
-- 3. the guard, extended (rate limit stays site-wide at 10 s)
-- ---------------------------------------------------------------------
create or replace function public.comments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1 from public.comments c
       where c.user_id = new.user_id and c.created_at > now() - interval '10 seconds'
    ) then
      raise exception 'You are commenting too fast. Please wait a few seconds.';
    end if;

    if new.parent_id is not null then
      if new.target_type = 'anime' then
        if not exists (
          select 1 from public.comments p
           where p.id = new.parent_id and p.parent_id is null
             and p.anilist_id = new.anilist_id and p.deleted_at is null
        ) then
          raise exception 'Invalid reply target.';
        end if;
      else
        if not exists (
          select 1 from public.comments p
           where p.id = new.parent_id and p.parent_id is null
             and p.target_type = new.target_type
             and p.post_id is not distinct from new.post_id
             and p.announcement_id is not distinct from new.announcement_id
             and p.deleted_at is null
        ) then
          raise exception 'Invalid reply target.';
        end if;
      end if;
    end if;
  else
    -- unchanged behaviour: only is_spoiler / deleted_at may move
    new.user_id := old.user_id;
    new.anilist_id := old.anilist_id;
    new.episode_number := old.episode_number;
    new.parent_id := old.parent_id;
    new.body := old.body;
    new.created_at := old.created_at;
    new.target_type := old.target_type;
    new.post_id := old.post_id;
    new.announcement_id := old.announcement_id;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists comments_guard_trg on public.comments;
create trigger comments_guard_trg before insert or update on public.comments
  for each row execute function public.comments_guard();

-- one place that knows every comment URL, so notifications stop guessing
create or replace function public.comment_link(c public.comments) returns text
language sql stable set search_path = public as $$
  select case c.target_type
    when 'post' then
      '/community/post/' || c.post_id::text || '#comment-' || c.id::text
    when 'announcement' then
      '/community/announcements/' || c.announcement_id::text || '#comment-' || c.id::text
    else
      case when c.episode_number is null
        then '/media/' || c.anilist_id::text || '#comment-' || c.id::text
        else '/watch/' || c.anilist_id::text || '?ep=' || c.episode_number::text
             || '#comment-' || c.id::text
      end
  end
$$;

-- ---------------------------------------------------------------------
-- 4. comment_feed gains the new columns (added at the END of the list,
--    which is what CREATE OR REPLACE VIEW allows)
-- ---------------------------------------------------------------------
create or replace view public.comment_feed as
select c.id, c.anilist_id, c.episode_number, c.parent_id, c.user_id, c.body,
       c.is_spoiler, c.created_at, p.username, p.display_name, p.avatar_url,
       coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int as likes,
       coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int as dislikes,
       c.target_type, c.post_id, c.announcement_id
from public.comments c
left join public.public_profiles p on p.id = c.user_id
left join public.comment_reactions r on r.comment_id = c.id
where c.deleted_at is null
group by c.id, p.username, p.display_name, p.avatar_url;
grant select on public.comment_feed to anon, authenticated;
```

### 2.4 SQL - reactions, reports, blocks, moderation log

```sql
-- ---------------------------------------------------------------------
-- 5. reactions on posts and announcements
-- ---------------------------------------------------------------------
create table if not exists public.community_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('post','announcement')),
  post_id uuid references public.community_posts(id) on delete cascade,
  announcement_id uuid references public.announcements(id) on delete cascade,
  value smallint not null check (value in (1,-1)),
  created_at timestamptz not null default now(),
  constraint community_reactions_target_chk check (
    (target_kind = 'post' and post_id is not null and announcement_id is null) or
    (target_kind = 'announcement' and post_id is null and announcement_id is not null)
  )
);

create unique index if not exists community_reactions_post_uidx
  on public.community_reactions (post_id, user_id) where post_id is not null;
create unique index if not exists community_reactions_ann_uidx
  on public.community_reactions (announcement_id, user_id) where announcement_id is not null;

-- One way in: insert, switch, or clear. Written as a function so the API and
-- the UI cannot disagree, and so the counts always come back together.
create or replace function public.community_react(
  p_kind text, p_id uuid, p_value smallint
) returns table (likes int, dislikes int, mine smallint)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in to react.'; end if;
  if p_value is not null and p_value not in (1,-1) then
    raise exception 'Invalid reaction.';
  end if;

  if p_kind = 'post' then
    if not exists (
      select 1 from public.community_posts p
       where p.id = p_id and p.deleted_at is null and p.status = 'published'
    ) then raise exception 'Post not found.'; end if;

    if p_value is null then
      delete from public.community_reactions r
       where r.user_id = uid and r.post_id = p_id;
    else
      insert into public.community_reactions as r (user_id, target_kind, post_id, value)
      values (uid, 'post', p_id, p_value)
      on conflict (post_id, user_id) where post_id is not null
        do update set value = excluded.value;
    end if;

    return query
      select coalesce(count(*) filter (where r.value = 1), 0)::int,
             coalesce(count(*) filter (where r.value = -1), 0)::int,
             (select r2.value from public.community_reactions r2
               where r2.post_id = p_id and r2.user_id = uid)
        from public.community_reactions r where r.post_id = p_id;
  elsif p_kind = 'announcement' then
    if not exists (
      select 1 from public.announcements a
       where a.id = p_id and (a.expires_at is null or a.expires_at > now())
    ) then raise exception 'Announcement not found.'; end if;

    if p_value is null then
      delete from public.community_reactions r
       where r.user_id = uid and r.announcement_id = p_id;
    else
      insert into public.community_reactions as r (user_id, target_kind, announcement_id, value)
      values (uid, 'announcement', p_id, p_value)
      on conflict (announcement_id, user_id) where announcement_id is not null
        do update set value = excluded.value;
    end if;

    return query
      select coalesce(count(*) filter (where r.value = 1), 0)::int,
             coalesce(count(*) filter (where r.value = -1), 0)::int,
             (select r2.value from public.community_reactions r2
               where r2.announcement_id = p_id and r2.user_id = uid)
        from public.community_reactions r where r.announcement_id = p_id;
  else
    raise exception 'Invalid target.';
  end if;
end $$;

grant execute on function public.community_react(text, uuid, smallint) to authenticated;

-- ---------------------------------------------------------------------
-- 6. reports
-- ---------------------------------------------------------------------
create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  reporter_hash text,
  target_kind text not null check (target_kind in ('post','comment','announcement')),
  target_id uuid not null,
  reason text not null
    check (reason in ('spam','harassment','spoiler','inappropriate','copyright','other')),
  details text,
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  constraint community_reports_details_len
    check (details is null or char_length(details) <= 500)
);

-- one report per person per item; repeat reports would just be noise
create unique index if not exists community_reports_once_idx
  on public.community_reports (target_kind, target_id, reporter_id)
  where reporter_id is not null;
create index if not exists community_reports_open_idx
  on public.community_reports (created_at desc)
  where status = 'open';

-- ---------------------------------------------------------------------
-- 7. blocks (Phase 6; the table ships with the migration so the feed can
--    honour it as soon as it is used)
-- ---------------------------------------------------------------------
create table if not exists public.community_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint community_blocks_not_self check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------
-- 8. moderation trail
-- ---------------------------------------------------------------------
create table if not exists public.community_moderation_log (
  id bigserial primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('hide','unhide','remove','restore','role_change')),
  target_kind text not null check (target_kind in ('post','comment','announcement','profile')),
  target_id uuid not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists community_moderation_log_created_idx
  on public.community_moderation_log (created_at desc);
```

### 2.5 SQL - RLS and grants for every new table

```sql
-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------
alter table public.community_posts enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_blocks enable row level security;
alter table public.community_moderation_log enable row level security;

-- posts: public read of live, published rows; the author sees their own
-- hidden/removed rows; staff see everything.
drop policy if exists "community posts read" on public.community_posts;
create policy "community posts read" on public.community_posts
  for select to anon, authenticated
  using (
    (deleted_at is null and status = 'published')
    or auth.uid() = author_id
    or public.is_staff()
  );

-- posts: you may only write your own, and anonymous Supabase sessions
-- (the "continue as guest" path) may not post. Flip the second clause if
-- open question 1 is answered differently.
drop policy if exists "community posts insert own" on public.community_posts;
create policy "community posts insert own" on public.community_posts
  for insert to authenticated
  with check (
    auth.uid() = author_id
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and status = 'published'
  );

-- posts: update is soft delete only; the guard trigger freezes everything
-- else, and only staff may change status.
drop policy if exists "community posts update own" on public.community_posts;
create policy "community posts update own" on public.community_posts
  for update to authenticated
  using (auth.uid() = author_id or public.is_staff())
  with check (auth.uid() = author_id or public.is_staff());

-- comments: the existing policies did not know about the new target types.
-- Without this, a signed-in user could attach a comment to any post id.
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      target_type = 'anime'
      or (target_type = 'post' and exists (
            select 1 from public.community_posts p
             where p.id = post_id and p.deleted_at is null and p.status = 'published'))
      or (target_type = 'announcement' and exists (
            select 1 from public.announcements a
             where a.id = announcement_id
               and (a.expires_at is null or a.expires_at > now())))
    )
  );

-- reactions: own rows only (same shape as comment_reactions)
drop policy if exists "community reactions read own" on public.community_reactions;
create policy "community reactions read own" on public.community_reactions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "community reactions write own" on public.community_reactions;
create policy "community reactions write own" on public.community_reactions
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- reports: a signed-in user may file one and read back their own;
-- staff read all. Anonymous reports are allowed through the API route with a
-- hashed identifier, and are inserted with the service role.
drop policy if exists "community reports insert own" on public.community_reports;
create policy "community reports insert own" on public.community_reports
  for insert to authenticated with check (auth.uid() = reporter_id);
drop policy if exists "community reports read own" on public.community_reports;
create policy "community reports read own" on public.community_reports
  for select to authenticated using (auth.uid() = reporter_id or public.is_staff());

-- blocks: entirely private to the blocker
drop policy if exists "community blocks own" on public.community_blocks;
create policy "community blocks own" on public.community_blocks
  for all to authenticated
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- moderation log: staff read, nobody writes from a browser
drop policy if exists "community moderation log read" on public.community_moderation_log;
create policy "community moderation log read" on public.community_moderation_log
  for select to authenticated using (public.is_staff());

-- announcements: visitors see them (the bell only ever needed signed-in
-- readers, the feed needs everyone), admins manage them.
drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to anon, authenticated
  using (expires_at is null or expires_at > now());

drop policy if exists "announcements manage admin" on public.announcements;
create policy "announcements manage admin" on public.announcements
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- moderation log is written by the service role only
revoke insert, update, delete on public.community_moderation_log from anon, authenticated;
```

### 2.6 SQL - the feed query (cursor pagination, filters, "new since")

One function, one set of rules. It is `security definer` **and therefore does not
read the RLS-protected tables through RLS**: every rule is written out in the
`WHERE` clauses below. That is deliberate - a view would be a second read path
with a second set of rules, and `security definer` functions do not inherit an
invoker view's RLS context anyway (the current user inside the function is the
function owner).

```sql
-- ---------------------------------------------------------------------
-- 10. the feed
-- ---------------------------------------------------------------------
create or replace function public.community_feed_page(
  p_limit int default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_key text default null,
  p_kind text default 'all',          -- all | post | comment | announcement | clips
  p_show_adult boolean default false,
  p_author uuid default null,
  p_anilist_id bigint default null,
  p_hide_blocked boolean default true
) returns table (
  feed_key text, kind text, created_at timestamptz,
  author_id uuid, author_username text, author_display_name text, author_avatar text,
  body text, is_spoiler boolean, title text, image_url text, link_url text,
  clip_code text, clip_start numeric, clip_end numeric,
  anime_id bigint, anime_title text, anime_cover text, episode_number int,
  target_url text, reply_count int, likes int, dislikes int
)
language sql stable security definer set search_path = public as $$
with lim as (select least(greatest(coalesce(p_limit, 20), 1), 50) as n),
src as (
  -- ---------- posts ----------
  (
    select
      'post:' || p.id::text as feed_key,
      'post'::text as kind,
      p.created_at,
      p.author_id,
      pr.username::text, pr.display_name::text, pr.avatar_url::text,
      case when p.is_spoiler then null else p.body end as body,
      p.is_spoiler,
      null::text as title,
      null::text as image_url,
      p.link_url,
      cl.code::text as clip_code,
      cl.start_seconds as clip_start, cl.end_seconds as clip_end,
      cl.anilist_id as anime_id,
      coalesce(a.title_english, a.title)::text as anime_title,
      a.cover_url::text as anime_cover,
      cl.episode_number,
      '/community/post/' || p.id::text as target_url,
      (select count(*)::int from public.comments rc
        where rc.post_id = p.id and rc.parent_id is null and rc.deleted_at is null) as reply_count
    from public.community_posts p
    left join public.profiles pr on pr.id = p.author_id
    left join public.clips cl on cl.id = p.clip_id and cl.deleted_at is null
    left join public.anime a on a.anilist_id = cl.anilist_id
    where p.deleted_at is null
      and p.status = 'published'
      and (p_kind in ('all','post','clips'))
      and (p_kind <> 'clips' or p.clip_id is not null)
      and (p_author is null or p.author_id = p_author)
      and (p_anilist_id is null or cl.anilist_id = p_anilist_id)
      and (not p_hide_blocked or not exists (
            select 1 from public.community_blocks b
             where b.blocker_id = auth.uid() and b.blocked_id = p.author_id))
      and (p_cursor_created_at is null
           or p.created_at < p_cursor_created_at
           or (p.created_at = p_cursor_created_at
               and 'post:' || p.id::text < coalesce(p_cursor_key, '')))
    order by p.created_at desc, feed_key desc
    limit (select n from lim)
  )
  union all
  -- ---------- episode / anime comments ----------
  (
    select
      'comment:' || c.id::text,
      'comment'::text,
      c.created_at,
      c.user_id,
      pr.username::text, pr.display_name::text, pr.avatar_url::text,
      case when c.is_spoiler then null else c.body end,
      c.is_spoiler,
      null::text,
      null::text,
      null::text,
      null::text, null::numeric, null::numeric,
      c.anilist_id,
      coalesce(a.title_english, a.title)::text,
      a.cover_url::text,
      c.episode_number,
      case when c.episode_number is null
        then '/media/' || c.anilist_id::text || '#comment-' || c.id::text
        else '/watch/' || c.anilist_id::text || '?ep=' || c.episode_number::text
             || '#comment-' || c.id::text
      end,
      (select count(*)::int from public.comments rc
        where rc.parent_id = c.id and rc.deleted_at is null)
    from public.comments c
    left join public.profiles pr on pr.id = c.user_id
    left join public.anime a on a.anilist_id = c.anilist_id
    where c.target_type = 'anime'
      and c.deleted_at is null
      and c.parent_id is null
      and (p_kind in ('all','comment'))
      and (coalesce(a.is_adult, false) = false or p_show_adult)
      and (p_anilist_id is null or c.anilist_id = p_anilist_id)
      and (not p_hide_blocked or not exists (
            select 1 from public.community_blocks b
             where b.blocker_id = auth.uid() and b.blocked_id = c.user_id))
      and (p_cursor_created_at is null
           or c.created_at < p_cursor_created_at
           or (c.created_at = p_cursor_created_at
               and 'comment:' || c.id::text < coalesce(p_cursor_key, '')))
    order by c.created_at desc, 1 desc
    limit (select n from lim)
  )
  union all
  -- ---------- announcements ----------
  (
    select
      'announcement:' || an.id::text,
      'announcement'::text,
      an.created_at,
      null::uuid,
      null::text, 'KumoriTV'::text, null::text,
      an.body,
      false,
      an.title,
      an.image,
      an.url,
      null::text, null::numeric, null::numeric,
      null::bigint, null::text, null::text, null::int,
      '/community/announcements/' || an.id::text,
      (select count(*)::int from public.comments rc
        where rc.announcement_id = an.id and rc.parent_id is null and rc.deleted_at is null)
    from public.announcements an
    where (an.expires_at is null or an.expires_at > now())
      and p_kind in ('all','announcement')
      and (p_author is null and p_anilist_id is null)
      and (p_cursor_created_at is null
           or an.created_at < p_cursor_created_at
           or (an.created_at = p_cursor_created_at
               and 'announcement:' || an.id::text < coalesce(p_cursor_key, '')))
    order by an.created_at desc, 1 desc
    limit (select n from lim)
  )
)
select s.*,
       coalesce((select sum(case when r.value = 1 then 1 else 0 end)::int
                   from public.community_reactions r
                  where r.post_id = substring(s.feed_key from 6)::uuid
                    and s.kind = 'post'), 0) as likes,
       coalesce((select sum(case when r.value = -1 then 1 else 0 end)::int
                   from public.community_reactions r
                  where r.post_id = substring(s.feed_key from 6)::uuid
                    and s.kind = 'post'), 0) as dislikes
from src s
order by s.created_at desc, s.feed_key desc
limit (select n from lim);
```

Two things to note about that last `SELECT`:

- `substring(s.feed_key from 6)::uuid` runs for comment and announcement rows too
  and would raise `invalid input syntax for type uuid`; the fix is a `CASE` that
  only casts for posts. **The Phase 1 implementation must write it as**
  `where r.post_id = case when s.kind = 'post' then substring(s.feed_key from 6)::uuid end`,
  which is `NULL` for other kinds and simply matches nothing. This is called out
  because it is exactly the kind of thing that passes a smoke test and fails on a
  comment row.
- Comment like/dislike counts are **not** in this function's result (they stay 0
  for comments). The feed card does not show them; the thread does. Adding two
  more correlated subqueries to every page of every source is not worth it.

```sql
-- ---------------------------------------------------------------------
-- 11. "new since" - the new-post bar and the "N new posts" pill
-- ---------------------------------------------------------------------
create or replace function public.community_new_posts(
  p_after timestamptz default null,
  p_limit int default 5,
  p_exclude_author uuid default null
) returns table (
  id uuid, created_at timestamptz,
  author_name text, author_avatar text,
  snippet text, has_clip boolean, clip_code text,
  anime_id bigint, episode_number int,
  total bigint
)
language sql stable security definer set search_path = public as $$
  with rows as (
    select p.id, p.created_at, p.author_id, p.body, p.is_spoiler, p.clip_id,
           cl.code as clip_code, cl.anilist_id, cl.episode_number
      from public.community_posts p
      left join public.clips cl on cl.id = p.clip_id and cl.deleted_at is null
     where p.deleted_at is null
       and p.status = 'published'
       and (p_after is null or p.created_at > p_after)
       and (p_exclude_author is null or p.author_id <> p_exclude_author)
     order by p.created_at desc
     limit least(greatest(coalesce(p_limit, 5), 1), 20)
  )
  select r.id, r.created_at,
         coalesce(pr.display_name, pr.username, 'Someone')::text,
         pr.avatar_url::text,
         case when r.is_spoiler then 'Spoiler post' else left(r.body, 120) end,
         (r.clip_id is not null),
         r.clip_code::text,
         r.anilist_id,
         r.episode_number,
         (select count(*) from public.community_posts p2
           where p2.deleted_at is null and p2.status = 'published'
             and (p_after is null or p2.created_at > p_after)
             and (p_exclude_author is null or p2.author_id <> p_exclude_author))
    from rows r
    left join public.profiles pr on pr.id = r.author_id
   order by r.created_at desc;
$$;

grant execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)
  to anon, authenticated;
grant execute on function public.community_new_posts(timestamptz,int,uuid)
  to anon, authenticated;
revoke execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean) from public;
revoke execute on function public.community_new_posts(timestamptz,int,uuid) from public;

-- ---------------------------------------------------------------------
-- 12. post guard: rate limits, duplicate body, frozen edits
-- ---------------------------------------------------------------------
create or replace function public.community_posts_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.community_posts p
                where p.author_id = new.author_id
                  and p.created_at > now() - interval '30 seconds') then
      raise exception 'You are posting too fast. Please wait a moment.';
    end if;
    if (select count(*) from public.community_posts p
         where p.author_id = new.author_id
           and p.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'You have reached the posting limit for this hour.';
    end if;
    if exists (select 1 from public.community_posts p
                where p.author_id = new.author_id
                  and btrim(lower(p.body)) = btrim(lower(new.body))
                  and p.created_at > now() - interval '10 minutes') then
      raise exception 'You just posted that.';
    end if;
    new.body := btrim(new.body);
    if char_length(new.body) = 0 then
      raise exception 'Write something first.';
    end if;
  else
    -- only these may move from a browser; status/pinned are staff-only and
    -- are enforced by the RLS "update own" policy plus this freeze.
    new.author_id := old.author_id;
    new.body := old.body;
    new.clip_id := old.clip_id;
    new.link_url := old.link_url;
    new.link_title := old.link_title;
    new.link_image := old.link_image;
    new.created_at := old.created_at;
    if not public.is_staff() then
      new.status := old.status;
      new.pinned := old.pinned;
      new.removed_reason := old.removed_reason;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists community_posts_guard_trg on public.community_posts;
create trigger community_posts_guard_trg before insert or update on public.community_posts
  for each row execute function public.community_posts_guard();
```

### 2.7 SQL - keeping the bell correct for post comments

Both notification triggers build their link from `anilist_id`/`episode_number`.
For a post comment that produced `'/media/'` with a null id. Replace the link
expression in `notify_comment_reply()` and `notify_comment_like()` with
`public.comment_link(...)`. The rest of both functions is unchanged; the two
lines to change are:

```sql
-- notify_comment_reply()
link := public.comment_link(new);

-- notify_comment_like()
link := public.comment_link(c);
```

`notify_comment_mentions()` uses the same pattern and gets the same one-line
change. Full replacement bodies can be copied from
`20261101000000_prompt21_push.sql` with only that line altered, so the diff stays
readable.

### 2.8 SQL - account deletion must cover the new tables

`app/api/account/delete/route.ts` currently deletes from `favourites`,
`watchlist`, `watch_progress`, `comments`, `comment_reactions`. Add:

```ts
for (const table of [
  "favourites", "watchlist", "watch_progress", "comments", "comment_reactions",
  "community_posts", "community_reactions", "community_blocks",
] as const) { /* same loop */ }
```

and for reports, **anonymise rather than delete** (a report is evidence about
someone else's content, and deleting it would erase the trail):

```ts
await admin.from("community_reports").update({ reporter_id: null }).eq("reporter_id", user.id);
```

`community_posts.author_id` cascades from `auth.users`, so posts disappear with
the account even if the loop missed them. Comments on posts cascade from
`community_posts`, so they go too. Announcement comments cascade from the
announcement, not the user, so they need the loop (which `comments` already
covers). Known and unchanged consequence: deleting a user also deletes every
reply to their comments (`comments.parent_id ... on delete cascade`). See risk
R4.

### 2.9 Announcements: creation, backfill, linking

**Nothing to backfill.** The feed reads `public.announcements` directly and the
bell reads the same table, so an announcement that exists today is already the
same item in both places. The only change is that the bell's `Open` now points at
`/community/announcements/{id}` instead of requiring a hand-typed `url`.

Creating one, today (SQL editor / Table Editor, as documented in the Prompt 21
migration):

```sql
insert into public.announcements (title, body, expires_at, image, url)
values (
  'Community is live',
  'Discuss episodes, post clips and follow announcements here.',
  now() + interval '30 days',
  null,
  null
)
returning id;
```

`url` stays optional and, when set, is rendered on the announcement page as a
"Visit link" button (external, `rel="nofollow ugc noopener noreferrer"`). It is
never the page's identity.

Creating one from an admin route (Phase 6, optional): `POST
/api/community/admin/announcements` with a session-authenticated `is_admin()`
check, body `{title, body, expiresAt, image, url}`, validated with the same rules
as `validateCreateClipBody` (explicit field list, length caps, https-only image),
then an insert with the **service role** and a `community_moderation_log` row.
`push_sent_at` is left null so the existing push cron picks it up exactly as it
does for a hand-inserted row.

---

## 3. API design

### 3.1 Where data is read (and why)

The repo's rule is: **browser client + RLS for user writes, service role only
server-side**. The community keeps that and adds one nuance - the feed's first
page is rendered on the server (so `/community` is indexable, fast, and has real
HTML), and later pages come from the browser.

| Read | How |
| --- | --- |
| First feed page | **server component** calls `community_feed_page` through the **server client** (`app/lib/supabase/server.ts`) so `auth.uid()` and the viewer's cookie are both available; `export const revalidate = 0` / `dynamic = "force-dynamic"` because the feed is personal (adult setting, blocks) |
| Next pages / "Load more" | **browser client** `supabase.rpc("community_feed_page", {...})` - the function is granted to `anon`, so this works signed out |
| Post page / announcement page | server component (metadata, OG) + client thread |
| Thread comments | `comment_feed` view filters by `post_id` / `announcement_id` (already granted to `anon`) |
| "My reaction" state | `community_reactions` (own rows, RLS) |
| New-post bar | `GET /api/community/latest` (public, ETag) |

No route handler is needed for the feed itself; adding one would be a second read
path to keep in sync. The RPC **is** the contract.

### 3.2 Routes

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/community/posts` | signed in, not anonymous | create a post (`body`, `is_spoiler`, `clip_code` or `link_url`) |
| `DELETE` | `/api/community/posts/[id]` | author or staff | soft delete (`deleted_at`), log if staff |
| `GET` | `/api/community/latest` | public | new-post bar + "N new posts" pill; `ETag`, `304` |
| `POST` | `/api/community/report` | public (anon allowed) | report a post / comment / announcement |
| `GET` | `/api/clips/mine` | session or guest cookie | clip picker: own recent clips (Phase 3) |
| `GET` | `/api/clips` | public | public clip browse list (Phase 5) |
| `POST` | `/api/community/admin/posts/[id]/status` | `is_admin()` from the session | hide / remove / restore (Phase 6) |
| `POST` | `/api/community/admin/announcements` | `is_admin()` | create an announcement (Phase 6, optional) |

Existing routes reused unchanged: `POST /api/clips` (create a clip from the
composer's "Make a clip" path), `GET /api/clips/[code]` (resolve a pasted clip
URL), `POST /api/clips/[code]/report`.

Every new route handler follows the shape of `app/api/clips/route.ts`:
`export const runtime = "nodejs"`, `export const dynamic = "force-dynamic"`, a
`STATUS: Record<string, number>` map, `Response.json({error, message}, {status})`,
`cache-control: no-store` on writes, and **never** a client-supplied user id.

### 3.3 Validation

No `zod` in `package.json`; the repo hand-writes validators
(`app/lib/clips/body.ts`, `range.ts`). New module `app/lib/community/body.ts`:

```ts
export const POST_BODY_MAX = 1000;
export const COMMUNITY_COMMENT_MAX = 400;

export type CreatePostInput = {
  body: string; isSpoiler: boolean;
  clipCode: string | null; linkUrl: string | null;
};

export function validateCreatePost(body: unknown): Validation<CreatePostInput>
```

Rules, in order:

1. object, not array; unknown keys ignored;
2. `body`: string, trimmed, 1..1000 after trimming, profanity-filtered with
   `bad-words` **on the server** (the client filter stays as a courtesy);
3. `isSpoiler`: boolean, default false;
4. `clipCode` xor `linkUrl`; a `clipCode` must pass `isClipCode()`
   (`app/lib/clips/code.ts`) and must resolve to a live clip
   (`getClipByCode`), otherwise `unknown_clip` (400);
5. `linkUrl`: `https?://` only, max 2048 chars, host normalised; **no** fetching.
   Any URL that is a `kumoritv.top/clip/<code>` is extracted into `clipCode`
   (see 4.4) and never stored as a plain link.

`POST /api/community/report`: `target_kind` in the enum, `target_id` a uuid,
`reason` in the enum, `details` <= 500 chars, plus a dedupe check (`409` when the
same reporter already reported the same target).

### 3.4 Rate limits

| Action | Limit | Where enforced |
| --- | --- | --- |
| Create post | 1 / 30 s, 20 / hour, identical body within 10 min rejected | **database** (`community_posts_guard`) - durable |
| Create post (burst) | 5 / minute per IP | API route, `createRateLimiter` (speed bump) |
| Comment (any target) | 1 / 10 s site-wide per user | **database** (`comments_guard`) - already exists |
| Comment (community) | 5 / minute per user | API-less: the browser inserts directly, so the 10 s guard is what holds; Phase 6 adds a durable `5/min` clause |
| Report | 5 / hour per reporter (session id or salted IP hash) | API route |
| Reactions | no explicit limit (idempotent upsert, 1 row per user) | - |
| `GET /api/community/latest` | 60 / minute per IP, plus `304` when idle | API route |

The in-memory limiter is explicitly **not** a security boundary (it is per
process); the database guards are. This is stated in a comment in
`app/lib/community/rate-limit.ts` so nobody later mistakes it for one.

### 3.5 Link previews for arbitrary URLs (proposal, opt-in, default OFF)

The brief says: only our own clip URLs are resolved as clips; other URLs are
plain links unless a safe design is justified. **Recommendation: plain links in
Phases 1-6. Do not build arbitrary link previews.** Reasons: an SSRF-safe fetcher
is a real security surface (DNS rebinding, redirects, huge bodies, slow hosts),
it needs caching and a queue to be usable, and a plain link already satisfies the
product need.

If it is ever wanted, the safe design already exists in this repo and must be
copied, not reinvented: `app/lib/seo/thumb.ts` - https only, no credentials in the
URL, DNS resolution checked against private ranges **on every redirect hop**, a
5 s per-hop and 12 s total budget, a 3 MB body cap, no cookie/header forwarding,
and an allow-list of hosts on top. Then, and only then, cache the result in
`community_posts.link_title/link_image` so the fetch happens once per link at
write time, never on read.

---

## 4. UI specification

### 4.1 Routes and files

| Route | File | Notes |
| --- | --- | --- |
| `/community` | `app/community/page.tsx` + `page.module.css` | the feed |
| `/community/post/[id]` | `app/community/post/[id]/page.tsx` | one post + its thread |
| `/community/announcements/[id]` | `app/community/announcements/[id]/page.tsx` | one announcement + its thread |
| `/community/announcements` | `app/community/announcements/page.tsx` | optional list (Phase 4, small) |
| `/clips` | existing `app/clips/page.tsx`, rewritten in Phase 5 | |

Component tree for `/community`:

```
app/community/page.tsx                    (server: first page, metadata)
└── CommunityShell                        (client: state, layout)
    ├── CommunityLeftRail                 (>=1200 only)
    │   ├── CommunityFilters              (All, Posts, Episode comments, Announcements, Clips)
    │   ├── CommunityGuidelines           (static copy, 4 bullets)
    │   └── CommunityNewPostPill          (aria-live polite: "3 new posts")
    ├── CommunityCentre
    │   ├── CommunityComposer             (desktop: inline card)
    │   │   ├── ComposerTextarea           (counter, spoiler toggle)
    │   │   ├── ComposerClipPicker         (Phase 3)
    │   │   ├── ComposerAttachmentPreview  (clip card / link chip)
    │   │   └── ComposerSubmit
    │   ├── CommunityFeed
    │   │   ├── PostCard | CommentCard | AnnouncementCard | ClipPostCard
    │   │   ├── FeedSkeleton   (initial)
    │   │   ├── FeedEmpty      (per filter)
    │   │   ├── FeedError      (retry button)
    │   │   └── LoadMore       (infinite via IntersectionObserver, button fallback)
    │   └── CommunityMobileFilterBar       (<768: sticky bottom, 5 chips)
    ├── CommunityRightRail                 (>=900 only, sticky)
    │   ├── TrendingAnimeCard              ("Trending this week" from existing data)
    │   ├── LatestAnnouncementsCard
    │   └── AiringThisWeekCard
    └── CommunityMobileComposeButton       (<768: FAB)
        └── ComposerSheet                  (full-screen sheet, focus trap)
```

State: **one client component owning the feed** (`CommunityShell`), with
`useReducer` for `{ items, cursor, filter, loading, error, hasMore }` and plain
`useState` for the composer draft. No Redux: the store in `app/lib/redux` is for
user/session/player concerns, and a feed is page state. Draft persistence is
`localStorage` with `try/catch` around every access (private mode throws):

```ts
const DRAFT_KEY = "kumori:community:draft";
try { localStorage.setItem(DRAFT_KEY, draft); } catch { /* draft is best effort */ }
```

Debounced 500 ms, cleared on successful submit, and **not** stored when the draft
is empty.

### 4.2 Card anatomy (the four types)

Common: `border-radius: var(--btn-border-radius)` (12px), background
`rgba(255,255,255,0.05)` over `--background #0B0B14`, 1px
`rgba(255,255,255,0.08)` border, 16px padding at >= 768 and 14px below,
`max-width: 680px` in the centre column, no shadows (the site has none), and a
hover state that lifts the border to `rgba(255,255,255,0.16)` only on
`(hover: hover)`.

**1. Post card**

```
┌───────────────────────────────────────────────┐
│ (avatar 40) Name · @handle      2h · ⌄ menu   │  header row
│ Spoiler pill (if flagged)                     │
│ Body text, 16px/1.55, up to 8 lines in feed,  │
│  "Show more" beyond that (ExpandableText)     │
│ [ clip thumb 16:9 max 100% | link chip ]      │
│ ♡ 12   ♡̶ 2   Reply 4   Share   Report        │  action row, 44px targets
└───────────────────────────────────────────────┘
```

**2. Episode / anime comment card** (this is the "where it was made" card)

```
┌───────────────────────────────────────────────┐
│ (cover 32x44) One Piece · Episode 1085   · 3h │  ← "Where", not the author
│ (avatar 28) Name commented on that episode    │
│ Body text (3 lines clamped on mobile)         │
│ “Open the thread” ↗   Reply 7                 │
└───────────────────────────────────────────────┘
```

The whole card is one link to the deep link (5.3). The cover is
`/thumb/{anilist_id}/{episode}` so it is same-origin and cached; for an anime-level
comment the cover is `anime.cover_url` through the same proxy path. **No like
counts** on this card (they live in the thread), **reply count is shown** - see
5.3 for the reasoning.

**3. Announcement card** (pinned, labelled)

```
┌───────────────────────────────────────────────┐
│ 📢 ANNOUNCEMENT · pinned · 1d                 │  label chip, brand violet
│ Title (h3, 18-20px, 600)                      │
│ Body (2 lines clamped)                        │
│ [ optional image, 16:9 ]                       │
│ Open · 3 comments                             │
└───────────────────────────────────────────────┘
```

Announcements are **not** sorted to the top of "All". They are pinned *within the
list* by the filter chip "Announcements" and by a single pinned card at the very
top of "All" **only if it was created in the last 7 days** - otherwise a year-old
announcement would sit above every new post forever. This is a judgement call and
is open question 5.

**4. Clip post card** - a post card whose attachment is a clip:

```
┌───────────────────────────────────────────────┐
│ (avatar) Name · @handle                  2h   │
│ “This fight goes so hard”                      │
│ ┌───────────────────────────────────────────┐ │
│ │  /thumb/21/1085  16:9, object-fit: cover  │ │
│ │  ▶ 1:02 - 1:17 · 15s · One Piece E1085    │ │  overlay
│ └───────────────────────────────────────────┘ │
│ ♡ 12  Reply 4  Share  Report                  │
└───────────────────────────────────────────────┘
```

Tapping the thumbnail opens `/clip/{code}` (the existing player), not the post.
The post body is the link to `/community/post/{id}`.

### 4.3 Responsive rules (exact)

| Width | Grid | Left rail | Right rail | Composer | Filters |
| --- | --- | --- | --- | --- | --- |
| `>= 1200px` | `grid-template-columns: 232px minmax(0, 680px) 300px; gap: 24px; justify-content: center` | visible, `position: sticky; top: 88px` | visible, sticky | inline card at the top of the centre column | vertical list in the left rail |
| `900-1199px` | `grid-template-columns: minmax(0, 680px) 264px; gap: 20px` | **hidden** (its filters move into a horizontal chip row above the composer) | visible, sticky | inline | horizontal chip row, scrollable, no wrap |
| `768-899px` | single column, `max-width: 680px; margin: 0 auto` | hidden | hidden | inline | horizontal chip row |
| `< 768px` | single column, full width, `padding: 0 12px 96px` | hidden | hidden | **FAB** bottom-right (`56px`, `bottom: 16px`, above the filter bar) opening a full-screen sheet | **sticky bottom bar**, `position: sticky; bottom: 0`, 5 chips, 44px tall targets, `backdrop-filter: blur(12px)` |

Gutters reuse `var(--page-gutter)` so `/community` aligns with the header. The
page wrapper is `max-width: var(--max-width)` (1380px), like `/clips`.

**No layout shift:** every card has an intrinsic placeholder (avatar 40px, media
`aspect-ratio: 16/9`), skeletons match the final card height within 8px, and
images carry `width`/`height` or `fill` inside a fixed-ratio box. Font sizes use
the existing clamp tokens; nothing below `0.875rem` (14px), so the "no 10-11px
text" rule holds. Tap targets are `min-height: 44px` on every interactive row,
including the small icon buttons, which get `padding: 10px` and a negative margin
so the visual size stays small.

### 4.4 Composer behaviour

- Textarea autogrows to 8 lines, then scrolls. Character counter bottom-right:
  `0 / 1000`, turns amber at 900, red at 1000, submit disabled when empty or over.
- **Spoiler toggle**: a chip `Mark as spoiler`, `aria-pressed`, brand violet when
  on. Spoiler posts are hidden with a blur + "Spoiler, tap to reveal" everywhere,
  including in the author's own view (simplest, consistent).
- **Clip picker** ("Add clip", Phase 3): a popover (`--z-page-popover`) with two
  tabs.
  - *My recent clips*: `GET /api/clips/mine` (`listUserClips` for a session,
    `listClipsByOwnerHash` for a guest cookie - this is the new bit). Each row:
    thumbnail `/thumb/{anilist}/{ep}`, `Anime · E12`, `1:02 - 1:17`, `15s`.
    20 most recent, "Paste a clip URL instead" at the bottom.
  - *Paste clip URL*: an input; on change, the text is matched against
    `^https?://(?:www\.)?kumoritv\.top/clip/([a-z0-9]{7})$` (also accept a bare
    code). On match, `GET /api/clips/{code}` resolves the preview (thumbnail,
    anime title, episode, range, duration). No scraping, no fetching of
    third-party URLs.
- **Paste detection anywhere in the composer**: the same regex runs on the
  textarea's `onPaste` and on every change; a match is **extracted** from the text
  (removed) and turned into the attachment preview, with an inline note
  "Clip attached". A non-clip URL stays as text and is linkified on render. This
  deliberately avoids ambiguous "is this a clip or a link" states.
- **Draft**: persisted (4.1), restored with a "Draft restored" note and a
  "Discard" button.
- **Sheet (mobile)**: full-screen, header with Cancel / Post, textarea fills,
  attachment row above the keyboard, `padding-bottom: env(safe-area-inset-bottom)`,
  focus trapped, `Escape` closes, body scroll locked while open.
- Submit states: idle -> sending (button spinner, form disabled) -> error (inline
  `role="alert"` under the composer, retry keeps the text) -> success (composer
  clears, the new post is inserted at the top of the feed optimistically with a
  temporary id, replaced by the server row).

### 4.5 The new-post bar (requirement B, precisely)

`app/components/CommunityToast/` mounted **once** in `app/layout.tsx` as a sibling
of `{children}` inside `<AuthProvider>` (so `useUser()` works).

Behaviour:

1. **Source:** `GET /api/community/latest?after=<cursor>&limit=5`, every 30 s,
   with `If-None-Match`. `document.visibilityState === "hidden"` stops the timer;
   `visibilitychange` back to visible polls immediately once and restarts.
2. **Cursor:** the newest `created_at` seen so far, seeded from the page's server
   render. Never from `localStorage` (a returning visitor must not get a backlog
   of toasts).
3. **Suppression:** author's own posts (`author_id === user.id`), `/community`
   and `/community/*` (`usePathname()`), `document.fullscreenElement !== null`
   (with a `fullscreenchange` listener), and the user's setting (4.6).
4. **Throttle:** at most one toast per 10 s; anything newer is **collapsed** into
   the next one ("Ada and 2 others posted"), never queued as separate toasts.
5. **Duration:** exactly 5 s (`TOAST_VISIBLE_MS = 5000`), then it fades out (200
   ms). Hover/focus pauses the timer; a keyboard focus inside the toast keeps it
   open until blur, which is the accessible behaviour.
6. **Desktop layout (>= 768px):** fixed top-centre, `top: 76px` (below the
   header), `max-width: 420px`, avatar 32px + `Name` (600) + message (2 lines,
   `-webkit-line-clamp: 2`) + optional clip thumbnail 64x36 on the right. Entire
   toast is one `<a href="/community/post/{id}">`. Dismiss `×` is a 44px button.
7. **Mobile layout (< 768px), exactly as specified:** **one line**,
   `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, and the clip
   video icon is a **sibling after** the truncating span, not inside it:

```tsx
<div className={styles.toast_mobile}>
  <span className={styles.toast_mobile_text}>{author} · {message}</span>
  {hasClip && <VideoIcon aria-hidden="true" className={styles.toast_mobile_icon} />}
</div>
```

   with `.toast_mobile { display: flex; align-items: center; gap: 8px; }`,
   `.toast_mobile_text { min-width: 0; flex: 1 1 auto; white-space: nowrap;
   overflow: hidden; text-overflow: ellipsis; }`,
   `.toast_mobile_icon { flex: 0 0 auto; }`. If the icon were inside the
   truncating element it would be clipped whenever the text overflows, which is
   the bug the requirement is guarding against.
8. **Motion:** transform/opacity only; `@media (prefers-reduced-motion: reduce)`
   removes the slide and keeps a 1-frame opacity change (no movement).
9. **A11y:** the toast host is `role="status" aria-live="polite"
   aria-atomic="true"`; it is not focusable on appear (would steal focus); its
   link is reachable by `Tab`. The "N new posts" pill inside the feed is
   `role="status"` too, so a feed reader gets one announcement, not two - the pill
   is only rendered while the user is on `/community`, where the toast is
   suppressed.

### 4.6 The settings switch

The existing pattern is `SwitchRow` (`app/layout/header/components/User/UserSettingsModal/SwitchRow.tsx`)
inside `NotificationsSection.tsx`. Add a **Community** row to the same section
(the modal is the site's settings surface):

```tsx
<SwitchRow
  id="community-new-post-toasts"
  name="communityToasts"
  label="New post notifications"
  description="Show a small bar when someone posts in Community."
  checked={toasts}
  onChange={save}
/>
```

Persistence: `profiles.community_toasts boolean not null default true` (one
column, Phase 4) updated with the browser client (RLS: own row), mirrored to
`localStorage` so guests and signed-out users have a setting too. Default **on**.
A guest's choice lives only in `localStorage`.

### 4.7 States

- **Skeleton**: 6 cards with the real geometry (avatar circle, two text lines at
  60% and 90% width, optional media box). No shimmer animation under
  `prefers-reduced-motion`; a static 8% white block instead.
- **Empty (per filter)**: an icon, one sentence ("No clips yet. Be the first to
  share a moment."), and a primary action (Open the composer / Browse clips).
- **Error**: the card-shaped message + `Try again`; a failed "load more" keeps
  the loaded items and shows a small retry row (never wipes the list).
- **Offline / 429**: "You're posting too quickly. Try again in Ns." with the
  `retryAfter` from the response header, in the inline alert slot.
- **Signed out**: the composer is replaced by a card with "Sign in to post" that
  dispatches `toggleShowLoginModalValue()` (the existing Redux action), matching
  `CommentsSection`.

### 4.8 Accessibility

- Landmarks: `<main>` with one `<h1>Community</h1>`; the rails are `<aside>` with
  `aria-label`; the feed is a `<ul>` of `<li>` cards (stable `key`s).
- Filters are a `role="tablist"`-like group of `<button aria-pressed>` (not tabs,
  because they filter rather than swap panels), inside a
  `<nav aria-label="Feed filters">`.
- Focus order: skip link -> filters -> composer -> feed -> rails. On filter
  change, focus stays on the chip and the feed's `aria-live="polite"` region
  announces "12 posts".
- Every avatar has an `alt` of the author name; decorative icons
  `aria-hidden="true"`; the clip thumbnail's `alt` is "Clip from {anime} episode N".
- Colour contrast: body text `--white-75` on `#0B0B14` (>= 9:1); no text below
  14px; focus rings use `:focus-visible` with a 2px brand outline and 2px offset,
  never removed.
- Reduced motion: no slide, no shimmer, no smooth scroll (`scrollIntoView` uses
  `{behavior: reduce ? "auto" : "smooth"}`).

### 4.9 `/clips` redesign (Phase 5)

**Finding that changes the scope:** `/clips` today is **"My Clips"** - a private,
`noindex`, signed-in-only list (`app/clips/page.tsx`), with a `SignedOutPrompt`
for guests and no public listing anywhere in the app. There is **no public clip
browse page** to redesign. So Phase 5 is two things: (a) a public listing API
(`GET /api/clips?sort=latest|views|week&anime=<id>&q=<search>&cursor=`) over
`clips where deleted_at is null`, joined to `anime` through `getAnimeSummaries()`,
and (b) the visual redesign with a tab switch.

Spec:

- Header: `Clips` (`h1`, `--font-size--h4`), a count, and a segmented control
  `All clips | My clips` (the second tab only when signed in; guests see a
  `Sign in to see yours` inline link).
- Filter row: `Latest` (default), `Most viewed`, `This week`, plus an anime
  search input (`<form role="search">`, debounced 300 ms, `GET /api/clips?q=`,
  matching on the joined anime title - the same idea as
  `app/lib/users/search.ts`, server side).
- Grid: `repeat(auto-fill, minmax(260px, 1fr))` at >= 768px, `gap: 16px`;
  single column list below 768px with a 96px thumbnail on the left.
- Clip card: 16:9 `/thumb/{anilist_id}/{episode}` with `object-fit: cover`,
  play badge, a duration chip bottom-right (`15s`), body = anime title (2-line
  clamp) + `E{episode} · {range}`, meta row `12.4k views · 3d ago` and the
  author name when `user_id` is present ("Guest" otherwise - the row genuinely
  has no identity for guest clips, and inventing one would be a lie). Actions:
  copy link (existing behaviour from `MyClipsList`), open, and `Report clip`
  (reuse `ReportClip`).
- States: skeleton grid (6 cards), empty ("No clips yet" + "Make one while
  watching"), error + retry, and an end-of-list marker instead of infinite
  scroll for the public list (a "Load more" button keeps SEO and the back button
  sane).
- `robots: { index: true }` on the public tab only, **no** sitemap entries (5.x),
  canonical `/clips`.
- Mobile: sticky filter bar (same component as `/community`'s, reused), cards
  full width, 44px targets, no horizontal overflow at 360px.

`MyClipsList` keeps its copy/rename/delete actions; only its container styling
changes to match the new cards.

---

## 5. Merging the three sources into one feed

### 5.1 Ordering and why the k-way merge is correct

Every source is ordered by `(created_at desc, feed_key desc)`, and `feed_key` is
unique across the union (`post:<uuid>`, `comment:<uuid>`,
`announcement:<uuid>`). The cursor is the pair `(cursor_created_at,
cursor_key)`.

`community_feed_page` takes **at most `p_limit` rows from each source** after the
cursor, unions them, sorts, and takes `p_limit`. This is not a heuristic: if a
row is not among the first `N` of its own source, there are already `N` rows in
that source newer than it, so it cannot be in the global first `N` either. The
merge is exact, and the cost is bounded by `3 x limit` rows regardless of table
size.

Stability under concurrent inserts: keyset pagination never skips or repeats a
row that already existed when the cursor was created; new rows simply appear
above the cursor and are fetched only on a refresh. That is the correct behaviour
for a live feed (and the reason "N new posts" exists instead of injecting rows
into the current scroll position).

Filter mapping:

| Chip | `p_kind` | Effect |
| --- | --- | --- |
| All | `all` | everything |
| Posts | `post` | `community_posts` only (clip posts included) |
| Episode comments | `comment` | anime/episode comments only |
| Announcements | `announcement` | `announcements` only |
| Clips | `clips` | posts that have `clip_id` set |

`p_author` powers `/community?author=<uuid>` (a profile view), `p_anilist_id`
powers `/community?anime=<id>` (all comments for one title) - cheap, and the
right-hand rail's "Trending" links use it.

### 5.2 Dedupe

Nothing to dedupe *between* sources: a post is a post, a comment is a comment, an
announcement is an announcement, and each has its own `feed_key`. Two cases that
would look like duplicates and must not be:

1. **A comment notification vs the comment card.** `user_notifications` is a
   bell concept and never enters the feed.
2. **An announcement's own comment** appears as a comment on the announcement
   page, not in the global feed (global feed shows only `target_type='anime'`
   comments, which is what the brief asks for: "every comment made on any episode
   or anime page"). This is deliberate and is why the `comment` arm filters
   `target_type = 'anime'`.

### 5.3 "Where it was made" deep links, exactly

| Source | URL |
| --- | --- |
| Episode comment | `/watch/<anilist_id>?ep=<episode_number>#comment-<comment.id>` |
| Anime-level comment | `/media/<anilist_id>#comment-<comment.id>` |
| Post | `/community/post/<post.id>` |
| Announcement | `/community/announcements/<announcement.id>` |
| Comment on a post | `/community/post/<post.id>#comment-<comment.id>` |
| Comment on an announcement | `/community/announcements/<id>#comment-<comment.id>` |

The single source of truth for these strings is `public.comment_link(comments)`
(2.3) on the server and `commentUrl(row)` in
`app/lib/community/links.ts` on the client. They must be tested against each
other (unit test asserting both produce the same string for six fixtures).

**What has to change for the hash to work:**

1. `CommentContainer` gets `id={"comment-" + comment.id}` (today it only has
   `data-comment-id`).
2. `CommentsSection` accepts `focusCommentId?: string`. On mount with a value it:
   fetches that one row from `comment_feed` by id, prepends it if it is not in the
   first page, expands its parent (if it is a reply), scrolls it into view, and
   adds `data-focus="true"` for 2.4 s (a brand-violet left border + a very light
   background tint, no animation under reduced motion).
3. Anchor geometry: `#comment-<id> { scroll-margin-top: 96px }` so the sticky
   header (and on the watch page the sticky player) never covers it.
4. The media page must honour the hash on load: it is a server component, so the
   client `CommentsSection` reads `window.location.hash` on mount (no
   `useSearchParams` needed) and strips nothing from the URL.
5. The watch page already remounts comments per `?ep=` (`key={comments-${ep}}`),
   so `?ep=` + hash both apply on the same navigation.

**Reply count on the card: show it.** Reasons: it is the only way a reader knows
there is more to read, it costs one `count(*)` per row that the `comments`
index covers, and it makes the "open the thread" affordance honest. Replies are
never rendered as their own cards (5.2).

### 5.4 Adult and hidden titles

- **Excluded** when `coalesce(anime.is_adult, false)` is true and
  `p_show_adult` is false. The value comes from the same rule the rest of the site
  uses (`app/lib/anilist/adult-content.ts`: profile `show_adult`, else the
  `is_adult_content_enabled` cookie, default hidden). This is a **display
  preference, not an authorization boundary** - the site already lets a signed-in
  user read adult titles by flipping it, and `/media/<id>` is reachable. Stating
  this explicitly matters: nobody should later believe the feed is gating adult
  content.
- **Blocked users** (`community_blocks`): `p_hide_blocked` filters posts and
  comments by author. Comments by blocked authors vanish from the feed; the
  author's name still appears in *their own* threads (blocking is a feed
  convenience, not a visibility rule).
- **Hidden/removed posts** (`status <> 'published'`) never appear for anyone
  except the author (their own row) and staff (RLS + the RPC's `status =
  'published'`).
- Soft-deleted comments/posts (`deleted_at is not null`) never appear.
- A stale link to a removed item renders a 404 page with `noindex`, not an empty
  feed card.

### 5.5 Stable keys and pagination

React keys are `feed_key`, never array indices. `LoadMore` appends and never
replaces. The "N new posts" pill (only on `/community`) counts
`community_new_posts` rows newer than the current cursor and prepends them on
click, keeping the scroll position (`scrollBy` by the measured height difference,
which is why the pill is a button and not an automatic insertion).

---

## 6. Phased build plan

Each phase ships alone, behind `COMMUNITY_ENABLED`. Effort is engineering time
for the implementation plus tests, not calendar time.

### Phase 1 - data model, posts, announcements page, bell and footer links

**Scope.** `community_posts`, `community_reactions`, `comments` extension,
`community_reports`, `community_feed_page` (posts + announcements arms only),
`community_new_posts`; `/community` with composer, post and announcement cards,
filters (All / Posts / Announcements); `/community/post/[id]`;
`/community/announcements/[id]`; comment-on-post via the existing
`CommentsSection` extended for `post_id`; bell `Open` -> announcement page;
footer Explore link.

**Files.** `supabase/migrations/20261120000000_prompt38_community.sql`;
`app/lib/community/{body,links,queries,rate-limit}.ts`;
`app/api/community/posts/route.ts`, `app/api/community/posts/[id]/route.ts`,
`app/api/community/report/route.ts`; `app/community/page.tsx` + `page.module.css`;
`app/community/components/*`; `app/components/CommentsSection/*` (target
support); `app/layout/footer/components/navLinks/index.tsx`;
`app/layout/header/components/Notifications/index.tsx`;
`app/lib/user-data/notifications.ts` (no shape change).

**SQL.** 2.3, 2.4 (reactions/reports), 2.5, 2.6, 2.7, 2.8.

**Tests.** `app/lib/community/__tests__/body.test.ts` (validator), `links.test.ts`
(URL truth table, six fixtures), `app/api/community/posts/__tests__/route.test.ts`
with `test-harness/fake-supabase.ts` (auth, validation, rate limit, profanity);
`app/community/__tests__/feed-render.test.tsx` (four card types, empty, error,
skeleton); a React test that `AnnouncementItem` renders `Open` without a `url`.
One Playwright spec: `/community` at 1440 and 412, post a text post, open it,
comment on it, open an announcement from the bell.

**Effort.** 3-4 days. **Risk.** Medium - the `comments` `ALTER` is the only
schema change on a live table; it is additive and the check constraint validates
instantly on all existing rows (all are `target_type='anime'`).

### Phase 2 - episode and anime comments in the feed, with deep links

**Scope.** the `comment` arm of `community_feed_page`, the "Episode comments"
filter, `CommentCard`, the "where it was made" header, `id="comment-<id>"` on
comments, `focusCommentId` on `CommentsSection`, reply counts, adult filtering.

**Files.** the migration's comment arm (new migration file
`..._prompt38b_community_comments.sql` to keep phases independently
deployable); `app/community/components/CommentCard/*`;
`app/components/CommentsSection/index.tsx`,
`components/CommentContainer/index.tsx`, `component.module.css`;
`app/lib/community/links.ts`; `app/media/[id]/page.tsx` (pass through the hash -
no change needed if `CommentsSection` reads `location.hash`).

**Tests.** unit: `commentUrl()` and `comment_link()` parity; route/page test for
the comment arm (deleted, spoiled, adult, reply excluded, reply counted);
Playwright: from `/community`, click a comment card at 1440 -> lands on
`/watch/...?ep=...#comment-...`, the comment is visible, highlighted, and
`scroll-margin` keeps it under the header; same for `/media/...#comment-`.

**Effort.** 2-3 days. **Risk.** Medium-high: the deep link touches the two most
visited pages. Mitigation: the change to `CommentsSection` is additive (an
optional prop), and the highlight is CSS + a timer.

### Phase 3 - clip attachments (picker + URL resolution)

**Scope.** `POST /api/community/posts` accepts `clip_code`; `GET /api/clips/mine`
(session **and** guest owner cookie - `listClipsByOwnerHash` is new); the
composer's "Add clip" popover; paste detection and extraction; clip preview card;
`ClipPostCard` with `/thumb/{id}/{ep}`.

**Files.** `app/lib/clips/server.ts` (+`listClipsByOwnerHash`),
`app/api/clips/mine/route.ts`, `app/lib/community/body.ts` (clip validation),
`app/community/components/ComposerClipPicker/*`,
`ComposerAttachmentPreview/*`, `PostCard` media branch.

**Tests.** unit: URL extraction (accepts `https://kumoritv.top/clip/abc2345`,
`http://`, `www.`, bare code, rejects `evil.com/clip/...` and `javascript:`),
`validateCreatePost` clip xor link. Route test: guest cookie picker returns the
guest's clips and never another browser's. Playwright: create a clip on `/watch`,
go to `/community`, open the picker, attach, post, see the thumb and the range;
paste a clip URL into the composer and see it resolve without submitting.

**Effort.** 2-3 days. **Risk.** Medium. The guest listing is the part that has no
precedent; everything else reuses existing clip code.

### Phase 4 - new-post bar, polling, settings switch, announcement list

**Scope.** `GET /api/community/latest` with ETag/304; `CommunityToast` mounted in
`app/layout.tsx`; the 10 s throttle and collapse; fullscreen and `/community`
suppression; `profiles.community_toasts` + the `SwitchRow`; the "N new posts"
pill; `/community/announcements` index; `/community` added to
`STATIC_SITEMAP_PAGES` (one line) and `COMMUNITY_ENABLED` wired.

**Files.** `app/api/community/latest/route.ts`,
`app/components/CommunityToast/{index.tsx,component.module.css}`,
`app/layout.tsx`, `app/layout/header/components/User/UserSettingsModal/*`,
`app/community/components/CommunityNewPostPill/*`, `lib/sitemap.ts`,
`.env.example`.

**Tests.** unit: throttle/collapse state machine (pure function
`nextToast(state, now, items)`) with fake timers - 5 s visible, 1 per 10 s, own
post skipped, `/community` skipped; route: 200 with `ETag`, 304 with
`If-None-Match`, no body on 304. Playwright: toast timing measured at 5 s ±
300 ms; mobile 412px one-line truncation with the video icon **outside** the
ellipsis element (assert `scrollWidth > clientWidth` on the text span and that the
icon's `boundingBox` is inside the viewport); toast absent on `/community`; toast
absent while fullscreen (dispatch `fullscreenchange` in the test).

**Effort.** 2-3 days. **Risk.** Low-medium. The risk is a leaked interval or a
toast that fires during navigation; both are covered by the unmount test.

### Phase 5 - `/clips` redesign (public browse + same visual language)

**Scope.** `GET /api/clips` (public, `latest|views|week`, anime search, cursor),
`/clips` with the `All clips | My clips` switch, clip grid/list, filter bar,
states, mobile layout, `robots` change.

**Files.** `app/api/clips/route.ts` (add `GET`),
`app/lib/clips/server.ts` (+`listPublicClips`), `app/clips/page.tsx`,
`page.module.css`, `components/ClipGrid/*`, `components/ClipCard/*`
(`MyClipsList` re-skinned).

**Tests.** route: sort order, `week` window uses `created_at`, deleted rows
excluded, search matches the joined title; page render with fixtures (empty,
loading, error); Playwright at 360/768/1440: no horizontal overflow, 44px
targets, copy-link still works.

**Effort.** 2 days. **Risk.** Low, except the product decision (public list vs
private) - open question 9.

### Phase 6 - moderation, reports, rate-limit hardening

**Scope.** `profiles.role` + `is_staff()`/`is_admin()` (already in the Phase 1
migration) used by a small admin surface; the report inbox (a plain page under
`/community/admin` guarded by `is_admin()`); hide/remove/restore with
`community_moderation_log`; blocks in the feed (already supported, now exposed);
durable per-minute limits for community comments; server-side profanity for
anime comments (retrofit); account-deletion coverage for all new tables;
`/api/community/admin/announcements`.

**Files.** `app/community/admin/*`, `app/api/community/admin/*`,
`app/lib/community/moderation.ts`, the deletion route, one more migration.

**Tests.** role gating (a non-staff session gets 403 on every admin route), a
removed post 404s for everyone but staff, the log gets one row per action, the
report dedupe returns 409, deletion removes posts/reactions/blocks and nulls
`reporter_id`.

**Effort.** 3 days. **Risk.** Medium: this is the security-sensitive phase. It
should be reviewed line by line, and nothing in it should be able to grant a role.

### Summary

| Phase | Ships | Effort | Risk |
| --- | --- | --- | --- |
| 1 | data model, posts, announcements, bell + footer | 3-4 d | Medium (one live-table ALTER) |
| 2 | comments in the feed + deep links | 2-3 d | Medium-high (touches watch/media) |
| 3 | clip attachments | 2-3 d | Medium (guest listing is new) |
| 4 | new-post bar + polling + settings | 2-3 d | Low-medium |
| 5 | `/clips` redesign | 2 d | Low (product decision) |
| 6 | moderation + reports + hardening | 3 d | Medium (security) |

Total: **14-18 engineering days**, each phase independently shippable.

---

## 7. Test plan and rollout

### 7.1 Unit

- `app/lib/community/__tests__/body.test.ts` - `validateCreatePost`: length
  boundaries (0, 1, 400, 1000, 1001), whitespace only, clip xor link, bad code,
  `javascript:` and `data:` links, unknown keys ignored, profanity replaced.
- `links.test.ts` - the six-URL truth table from 5.3, plus parity with the SQL
  helper (assert the expected strings literally; the SQL side is covered by a
  page test).
- `throttle.test.ts` - `nextToast()` pure function with fake time: 5 s
  visibility, 1 per 10 s, collapse of 3 into "X and 2 others", own-post skip.
- `clip-url.test.ts` - extraction from pasted text, accepted/rejected hosts.
- `settings.test.ts` - the switch writes the profile row once and mirrors
  `localStorage`, survives a failed network write.

### 7.2 Route tests with a stand-in Supabase

`test-harness/fake-supabase.ts` already exists and is used by the Prompt 35
tests; the new route tests follow the same shape (inject a client, assert the
HTTP status and the JSON, assert **no** call happened when validation failed).

- `POST /api/community/posts`: 401 anonymous, 401 signed-out, 400 empty/too long,
  400 unknown clip, 400 `javascript:` link, 201 with a clip, 429 over the burst
  limit, 500 on insert failure, and the response never contains `author_id` from
  the body.
- `DELETE /api/community/posts/[id]`: 403 for another user's post, 200 for the
  author, 200 for staff with a log row, idempotent second delete.
- `GET /api/community/latest`: 200 + `ETag`, 304 on `If-None-Match`, own posts
  excluded, no full body in the payload, 429 over 60/min.
- `POST /api/community/report`: 200, 409 on duplicate, 400 unknown reason.
- `GET /api/clips` and `/api/clips/mine`: sort, guest cookie vs session, deleted
  rows excluded.

### 7.3 Playwright (real `next build` + `next start`, stubbed Supabase)

Reuse `test-harness/clips-e2e/playwright.config.ts` (a `stub.mjs` stands in for
Supabase Auth/PostgREST, AniList and the provider; no real service is contacted).
Add `test-harness/community-e2e/community.spec.ts` with projects at
**360, 412, 768, 1024, 1440, 1920**.

Assertions, per viewport:

1. **Layout.** Exactly one column below 768, two at 900-1199, three at >= 1200
   (count visible regions by `data-testid`), centre column `<= 680px + 1`.
2. **No horizontal overflow:** `document.documentElement.scrollWidth <= innerWidth`
   on `/community`, `/community/post/[id]`, `/community/announcements/[id]`,
   `/clips` at every width.
3. **Tap targets:** every `button`/`a` inside a card is >= 44px in one dimension.
4. **Toast timing:** trigger a new post from the stub, assert the toast appears,
   stays ~5 s (`expect.poll` with a 300 ms tolerance), then is gone; assert a
   second post inside 10 s does **not** produce a second toast.
5. **Mobile truncation:** at 412, a long post + clip shows one line
   (`getComputedStyle(text).whiteSpace === "nowrap"`, `scrollWidth >
   clientWidth`) and the video icon's box is fully inside the viewport and to the
   right of the text span.
6. **Suppression:** no toast on `/community`; none while `document.fullscreenElement`
   is set (the harness sets it through the player).
7. **Deep links:** comment card -> `?ep=#comment-`, comment visible, highlighted.
8. **No layout shift:** `PerformanceObserver` for `layout-shift` with
   `hadRecentInput === false` sums to < 0.1 on first load.

### 7.4 Rollout

1. **Flag:** `COMMUNITY_ENABLED` (server env, `"1"` to enable). `/community`
   returns `notFound()` when off; the footer link and the toast host render
   nothing; the migration is applied but no route is reachable.
2. **Hidden link until ready:** the footer `Community` link is rendered only when
   the flag is on (`process.env.COMMUNITY_ENABLED` read in the footer's server
   component, not in the client).
3. **Backfill:** none required (2.9). Existing comments are picked up by the feed
   immediately because the feed reads the table.
4. **Order:** apply the migration -> deploy with the flag **off** -> smoke
   `/api/community/latest` and the RPC by hand with `anon` -> enable for the
   owner's account (a `COMMUNITY_BETA_EMAILS` allow-list, same `notFound()`
   pattern) -> enable fully.
5. **Monitoring:** log structured lines `[community] feed page n=… kind=… ms=…`
   from the route where one exists, and count `community_reports` open rows
   daily; a `/api/admin/community-status` route (guarded by `requireCron`, like
   `app/api/admin/ani-status/route.ts`) reporting post/comment/report counts per
   hour, the top 5 reporters, and the rate-limit rejection count. Alert on
   insert failure rate > 1% or p95 feed time > 400 ms.

---

## 8. Risks and open questions

### 8.1 Risks

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | The `comments` `ALTER` (nullable `anilist_id`) breaks an existing query that assumed non-null | Low | High | Every existing query filters by `anilist_id` equality (null never matches), and the check constraint keeps anime rows as they were. Verified by the full `npm test` suite plus a manual `comment_feed` read. |
| R2 | The feed RPC becomes the hot path and a `count(*)` per row makes it slow | Medium at scale | Medium | The partial indexes in 2.3; `p_limit <= 50`; the correlated counts are index-only scans. Measure p95 in staging with 100k comments before Phase 4. |
| R3 | Deep linking a comment that is not in the first page shows an empty thread | Medium | Medium | `focusCommentId` fetches the row by id and prepends it (5.3.2); if the comment is deleted the page shows "This comment was deleted" rather than nothing. |
| R4 | Account deletion cascades: `comments.parent_id ... on delete cascade` already deletes every reply to a deleted user's comments; community makes that more visible | Certain (existing) | Medium | Documented here. Phase 6 can switch to "soft delete + anonymise" (`deleted_at = now()`, and a `[deleted]` render) so replies survive. |
| R5 | Realtime is expected by the owner and the plan chooses polling | Medium | Low | The `CommunityNewPostSource` interface (1.5) makes the swap one file. Numbers are in 1.5 and open question 12. |
| R6 | Adult content leaks into the feed through a comment on an adult title | Low | High (policy) | `coalesce(a.is_adult,false) = false or p_show_adult` in the RPC, plus a test fixture with an adult title. Stated plainly in 5.4 that this is a preference, not a gate. |
| R7 | Anonymous Supabase sessions post spam | Medium | Medium | RLS rejects `is_anonymous` posters; the DB guard limits 1/30 s and 20/h; the API adds an IP burst limit. |
| R8 | The in-memory rate limiter gives false confidence on serverless | High | Low | Documented in code and here; the durable limits are in the database. |
| R9 | `profiles` has no RLS, so community makes an existing minor leak more visible | Certain (existing) | Low | Enable RLS on `profiles` in Phase 6 (open question 14): `select own` + the `public_profiles` view for everyone else. |
| R10 | A guest lists someone else's clips via `/api/clips/mine` | Low | High (privacy) | The route derives the hash from the caller's own HttpOnly cookie and never accepts a token in the query string; constant-time compare (`ownerTokenMatches`). Tested. |
| R11 | Sitemap churn if community URLs are added | Low | Medium | No per-post URLs in any sitemap; at most one static entry for `/community`. |
| R12 | The toast steals focus or fires during navigation | Medium | Low | `role="status"` (never focused on appear), `usePathname()` suppression, cleanup on unmount, tested. |

### 8.2 Open questions for the owner

Each has a recommended default, so "yes to all defaults" is a complete answer.

1. **Must someone sign in to post and comment?**
   *Default: yes for posts and comments; anonymous Supabase sessions (the "continue
   as guest" path) cannot post. Reading is fully public.*
2. **Is there a minimum account age or activity before someone can post?**
   *Default: no hard gate in Phase 1; the 1/30 s and 20/h limits plus duplicate
   detection are the only gates. Revisit if spam appears.*
3. **Who can create announcements?**
   *Default: the owner only, by SQL (as today), with an optional
   `is_admin()`-gated route in Phase 6. No other user can ever create one.*
4. **Are comments from adult-flagged anime shown in the community feed?**
   *Default: only when the viewer's adult setting is on; hidden by default, and
   always hidden for guests until they turn it on.*
5. **Should announcements be pinned to the top of the feed forever, or only while
   recent?**
   *Default: pinned in the "Announcements" filter, and shown as a single pinned
   card at the top of "All" only for 7 days after creation.*
6. **Index policy:** should `/community` be indexable, and should individual
   posts and announcements be?
   *Default: `/community` indexed; individual **posts** `noindex, follow`;
   **announcements** `index, follow` (they are official, few, and stable);
   no community URL in any sitemap except the `/community` static entry.*
7. **Do new posts need approval before they appear?**
   *Default: no pre-moderation. Post-hoc: report flow, staff hide/remove, and a
   1/30 s + 20/h cap. Pre-moderation makes the feed feel dead and costs the owner
   time.*
8. **Are image uploads in scope, or links only?**
   *Default: links and clip thumbnails only. No uploads in 38B-38G: an upload
   pipeline (storage, moderation, cost, takedown) is its own project.*
9. **`/clips`: public browse page, or keep it as "My clips"?**
   *Default: public "All clips" tab plus a "My clips" tab for signed-in users;
   guest-created clips appear with no author name ("Guest"), because the schema
   genuinely has none.*
10. **Should the community link appear anywhere besides the footer Explore
    column?**
    *Default: footer Explore only, as instructed, until Phase 4 ships.*
11. **Do posts need a "share" affordance (copy link / native share)?**
    *Default: yes, a copy-link button (`navigator.share` when available) and
    nothing else. No cross-posting to other networks.*
12. **What is the actual Supabase plan (Realtime connections and message
    allowance)?**
    *Default: assume Free (200 connections / 2M messages per month) and therefore
    poll; switch to Realtime only if the plan is Pro or above and the site
    regularly has hundreds of concurrent readers.*
13. **Should replies to a feed comment be readable in the feed, or only in the
    original thread?**
    *Default: only in the original thread; the card shows the reply count, as
    specified.*
14. **May `profiles` be locked down with RLS (own row only, public columns via
    the `public_profiles` view)?**
    *Default: yes, in Phase 6. It is a pre-existing gap, not one this feature
    creates, but community makes profiles much more visible.*
15. **Blocking: is "block a user" in scope?**
    *Default: the table and the feed filter ship in Phase 1 (they cost nothing),
    the UI ships in Phase 6. Blocking hides a user's posts and comments from your
    feed; it does not hide their content from anyone else.*
16. **Deleting an account: should their posts and comments be removed, or kept as
    "[deleted]"?**
    *Default: posts removed; comments soft-deleted and rendered as "[deleted]" so
    replies survive (this changes today's cascade behaviour - see R4).*

---

## Appendix - files read for this plan

```
supabase/migrations/20261023000000_core.sql
supabase/migrations/20261027000000_prompt9_user_data.sql
supabase/migrations/20261027000100_prompt10_comments.sql
supabase/migrations/20261101000000_prompt21_push.sql
docs/sql/clips.sql
app/lib/comments/{queries,mentions,timeAgo}.ts
app/lib/user-data/notifications.ts
app/lib/supabase/{AuthProvider,browser,server,auth-server,admin}.ts
app/lib/clips/{constants,code,owner-token,server,request,rate-limit,body,range,time,title,url,views}.ts
app/lib/anilist/adult-content.ts
app/lib/seo/{thumb,og-image,text}.ts
app/lib/cron/auth.ts
lib/sitemap.ts
app/robots.ts
app/layout.tsx
app/layout/footer/index.tsx
app/layout/footer/components/navLinks/index.tsx
app/layout/header/index.tsx
app/layout/header/components/Notifications/index.tsx
app/layout/header/components/User/UserSettingsModal/{index,NotificationsSection,SwitchRow}.tsx
app/components/CommentsSection/** (index, CommentContainer, WriteCommentForm, MentionPicker, Dropdown)
app/media/[id]/page.tsx
app/watch/[id]/page.tsx
app/watch/[id]/components/{WatchLayout,ClipBridge,ClipPanel}
app/clips/{page.tsx,page.module.css,components/MyClipsList,components/SignedOutPrompt}
app/clip/[code]/{page.tsx,components/ClipPlayer,components/ReportClip}
app/api/clips/route.ts, app/api/clips/[code]/route.ts
app/api/account/delete/route.ts
app/api/admin/ani-status/route.ts
app/api/users/search/route.ts
app/thumb/[id]/[ep]/route.ts
app/sitemaps/[file]/route.ts, app/sitemaps/static.xml/route.ts
app/globals.css
package.json
test-harness/{fake-supabase.ts,clips-e2e/*}
```
