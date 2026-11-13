-- Prompt 38E, Community Phase 2: the episode/anime comment arm of the feed.
--
-- Run order (the owner runs these by hand, in this order):
--   1  docs/sql/profiles-rls.sql
--   2  docs/sql/community.sql
--   3  docs/sql/community-patch-1.sql
--   4  docs/sql/comments-deleted-users.sql
--   5  docs/sql/community-comments-arm.sql        <- this file
--
-- Run the files OR supabase/migrations/*, never both. The four earlier files are
-- not edited by this one; it only replaces a function and adds indexes.
--
-- Deploy order: the app code may be deployed BEFORE or AFTER this file. The
-- signature is unchanged (same argument types, same defaults) and the columns
-- that existed before keep their names, types and order; the only addition is
-- is_adult, appended last. The Phase 1 client reads the columns it knows and
-- ignores the new one, so a feed page keeps working across the deploy in either
-- order. The only visible difference before the file runs is that no comment
-- cards appear.
--
-- What it changes
--   1. community_feed_page(): a third arm, `comment`, for top-level comments on
--      anime and episodes (feed_key `comment:<uuid>`). Replies are never cards;
--      their count is the card's reply_count. Soft-deleted comments, comments
--      whose author was deleted (user_id is null, shown as "[deleted]" inside a
--      thread), and comments whose anime row is missing are excluded - a card
--      with no title or cover is not a card.
--   2. community_feed_page(): p_show_adult is now IMPLEMENTED. When it is false
--      (the default, and always false for guests) comments of an anime with
--      is_adult = true are excluded. When it is true they are included and the
--      new last column is_adult says so. This is a DISPLAY PREFERENCE, the same
--      one the rest of the site already uses (profile show_adult, else the
--      is_adult_content_enabled cookie, default hidden). It is NOT an
--      authorization boundary and NOT age verification: a signed-in user can
--      turn it on in settings, and /media/<id> is reachable regardless. Adult
--      clip posts are Phase 3 and are not filtered here.
--   3. Per-row counts without per-row scans: the page is materialised first
--      (at most p_limit rows), then likes/dislikes are aggregated once per
--      target table over just the ids on that page, and joined back. Comments
--      count public.comment_reactions; posts and announcements keep counting
--      public.community_reactions exactly as patch 1 fixed them.
--   4. Two supporting indexes:
--        comments_parent_idx            replies counted by reply_count
--        comments_anilist_feed_idx      /community?anime=<id> and the rail
--      Both are partial, matching the arm's WHERE clause.
--   5. The security definer hardening from patch 1 is kept: empty search_path,
--      every object schema-qualified, ACLs restated.
--   6. Because is_adult is a new OUT column, the function is DROPPED and
--      recreated inside this file's single transaction (CREATE OR REPLACE cannot
--      change a return type). The function name and argument list are unchanged,
--      so every caller - the app deployed before this file and the app deployed
--      after it - resolves to it the same way.
--
-- Verification queries (paste into the editor afterwards)
--   select p.proname, p.proconfig, pg_get_function_identity_arguments(p.oid)
--     from pg_proc p where p.proname = 'community_feed_page';
--   -- the new column is last, everything before it unchanged:
--   select pg_get_function_result('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure);
--   select indexname from pg_indexes
--    where indexname in ('comments_community_feed_idx','comments_anilist_feed_idx','comments_parent_idx');
--   select * from public.community_feed_page(5, null, null, 'comment', false, null, null, true);
--   select * from public.community_feed_page(5, null, null, 'all', true, null, null, true);
--   explain (analyze, buffers)
--     select * from public.community_feed_page(20, null, null, 'comment', false, null, null, true);
--   explain (analyze, buffers)
--     select * from public.community_feed_page(20, null, null, 'comment', false, null, 101, true);

begin;

-- --------------------------------------------------------------- 1 + 2 + 3 --
-- The result set gains is_adult at the end, and CREATE OR REPLACE cannot change
-- a function's OUT columns. The drop and the create are in the same transaction,
-- so the function is never missing for anyone: concurrent callers block on the
-- lock and then see the new definition. Nothing references this function by oid,
-- so no dependent object is lost; the ACLs are restated below anyway.
drop function if exists
  public.community_feed_page(integer, timestamp with time zone, text, text, boolean, uuid, bigint, boolean);

CREATE OR REPLACE FUNCTION public.community_feed_page(
  p_limit integer DEFAULT 20,
  p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_key text DEFAULT NULL::text,
  p_kind text DEFAULT 'all'::text,
  p_show_adult boolean DEFAULT false,
  p_author uuid DEFAULT NULL::uuid,
  p_anilist_id bigint DEFAULT NULL::bigint,
  p_hide_blocked boolean DEFAULT true
) RETURNS TABLE(
  feed_key text, kind text, created_at timestamp with time zone,
  author_id uuid, author_username text, author_display_name text, author_avatar text,
  body text, is_spoiler boolean, title text, image_url text, link_url text,
  clip_code text, clip_start numeric, clip_end numeric,
  anime_id bigint, anime_title text, anime_cover text, episode_number integer,
  target_url text, reply_count integer, likes integer, dislikes integer,
  is_adult boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
-- p_show_adult is a display preference, not an authorization boundary: it only
-- decides whether comments of an is_adult title are listed in the feed, exactly
-- like the profile/cookie switch the rest of the site already honours. Guests
-- always pass false. Adult clip posts are Phase 3 and are not filtered here.
with lim as (select least(greatest(coalesce(p_limit, 20), 1), 50) as n),
-- Which comments make the page, decided before anything is presented. Two
-- branches on p_anilist_id: inside a parameterised SQL function the planner sees
-- a generic parameter, and `(p_anilist_id is null or c.anilist_id = p_anilist_id)`
-- cannot use the anilist index. Splitting the filtered case into its own branch
-- with `c.anilist_id = (select p_anilist_id)` lets the single-title view
-- (/community?anime=<id> and the rail links) use comments_anilist_feed_idx.
cand as (
  (
    select c.id, c.created_at
    from public.comments c
    join public.anime a on a.anilist_id = c.anilist_id
    where c.target_type = 'anime'
      and c.parent_id is null
      and c.deleted_at is null
      and c.user_id is not null
      and (p_show_adult or not coalesce(a.is_adult, false))
      and p_kind in ('all','comment')
      and (p_author is null or c.user_id = p_author)
      and (not p_hide_blocked or not exists (
            select 1 from public.community_blocks b
             where b.blocker_id = auth.uid() and b.blocked_id = c.user_id))
      and p_anilist_id is null
      and (p_cursor_created_at is null
           or c.created_at < p_cursor_created_at
           or (c.created_at = p_cursor_created_at
               and 'comment:' || c.id::text < coalesce(p_cursor_key, '')))
    order by c.created_at desc, c.id desc
    limit (select n from lim)
  )
  union all
  (
    select c.id, c.created_at
    from public.comments c
    join public.anime a on a.anilist_id = c.anilist_id
    where c.target_type = 'anime'
      and c.parent_id is null
      and c.deleted_at is null
      and c.user_id is not null
      and (p_show_adult or not coalesce(a.is_adult, false))
      and p_kind in ('all','comment')
      and (p_author is null or c.user_id = p_author)
      and (not p_hide_blocked or not exists (
            select 1 from public.community_blocks b
             where b.blocker_id = auth.uid() and b.blocked_id = c.user_id))
      and c.anilist_id = (select p_anilist_id)
      and (p_cursor_created_at is null
           or c.created_at < p_cursor_created_at
           or (c.created_at = p_cursor_created_at
               and 'comment:' || c.id::text < coalesce(p_cursor_key, '')))
    order by c.created_at desc, c.id desc
    limit (select n from lim)
  )
),
src as (
  -- ---------------------------------------------------------------- posts --
  (
    select
      'post:' || p.id::text as feed_key,
      'post'::text as kind,
      p.created_at,
      p.author_id,
      pr.username::text as author_username,
      pr.display_name::text as author_display_name,
      pr.avatar_url::text as author_avatar,
      case when p.is_spoiler then null else p.body end as body,
      p.is_spoiler,
      null::text as title,
      null::text as image_url,
      p.link_url,
      cl.code::text as clip_code,
      cl.start_seconds as clip_start,
      cl.end_seconds as clip_end,
      cl.anilist_id as anime_id,
      coalesce(a.title_english, a.title)::text as anime_title,
      a.cover_url::text as anime_cover,
      cl.episode_number,
      '/community/post/' || p.id::text as target_url,
      (select count(*)::integer from public.comments rc
        where rc.post_id = p.id and rc.parent_id is null and rc.deleted_at is null) as reply_count,
      -- Truthful, but not filtered: adult *clip posts* are Phase 3.
      coalesce(a.is_adult, false) as is_adult
    from public.community_posts p
    left join public.public_profiles pr on pr.id = p.author_id
    left join public.clips cl on cl.id = p.clip_id and cl.deleted_at is null
    left join public.anime a on a.anilist_id = cl.anilist_id
    where p.deleted_at is null
      and p.status = 'published'
      and p_kind in ('all','post')
      and (p_author is null or p.author_id = p_author)
      and (p_anilist_id is null or cl.anilist_id = p_anilist_id)
      and (not p_hide_blocked or not exists (
            select 1 from public.community_blocks b
             where b.blocker_id = auth.uid() and b.blocked_id = p.author_id))
      and (p_cursor_created_at is null
           or p.created_at < p_cursor_created_at
           or (p.created_at = p_cursor_created_at
               and 'post:' || p.id::text < coalesce(p_cursor_key, '')))
    order by p.created_at desc, p.id desc
    limit (select n from lim)
  )
  union all
  -- --------------------------------------------------------- announcements --
  (
    select
      'announcement:' || an.id::text,
      'announcement'::text,
      an.created_at,
      null::uuid,
      null::text,
      'KumoriTV'::text,
      null::text,
      an.body,
      false,
      an.title,
      an.image,
      an.url,
      null::text, null::numeric, null::numeric,
      null::bigint, null::text, null::text, null::integer,
      '/community/announcements/' || an.id::text,
      (select count(*)::integer from public.comments rc
        where rc.announcement_id = an.id and rc.parent_id is null and rc.deleted_at is null),
      false
    from public.announcements an
    where (an.expires_at is null or an.expires_at > pg_catalog.now())
      and p_kind in ('all','announcement')
      and p_author is null
      and p_anilist_id is null
      and (p_cursor_created_at is null
           or an.created_at < p_cursor_created_at
           or (an.created_at = p_cursor_created_at
               and 'announcement:' || an.id::text < coalesce(p_cursor_key, '')))
    order by an.created_at desc, an.id desc
    limit (select n from lim)
  )
  union all
  -- ------------------------------------------------ comments (Phase 2) ------
  -- Top-level comments on anime and episodes only. A reply is never its own
  -- card (5.2); it shows up as the parent comment's reply_count. A comment with
  -- no author (account deleted, shown as "[deleted]" inside its thread) is not
  -- a feed card. The anime join is INNER on purpose: a row with no anime has no
  -- title and no cover to show, so it is excluded rather than rendered blank.
  -- The ids are chosen by cand; this pass only presents the chosen rows.
  (
    select
      'comment:' || c.id::text,
      'comment'::text,
      c.created_at,
      c.user_id,
      pr.username::text,
      pr.display_name::text,
      pr.avatar_url::text,
      -- Spoiler comments keep their title/cover and hide the body, exactly as
      -- spoiler posts do.
      case when c.is_spoiler then null else c.body end,
      c.is_spoiler,
      null::text, null::text, null::text,
      null::text, null::numeric, null::numeric,
      c.anilist_id,
      coalesce(a.title_english, a.title)::text,
      a.cover_url::text,
      c.episode_number,
      public.comment_link(c),
      (select count(*)::integer from public.comments rc
        where rc.parent_id = c.id and rc.deleted_at is null),
      coalesce(a.is_adult, false)
    from cand cd
    join public.comments c on c.id = cd.id
    join public.anime a on a.anilist_id = c.anilist_id
    left join public.public_profiles pr on pr.id = c.user_id
    order by c.created_at desc, c.id desc
    limit (select n from lim)
  )
),
-- The merge is exact: at most n rows per source after the cursor, so a row that
-- is not in its own source's first n cannot be in the global first n either.
page as (
  select * from src
  order by created_at desc, feed_key desc
  limit (select n from lim)
),
-- Counts once, over the ids on this page only (never a scan per row).
react as (
  select
    'post'::text as kind,
    r.post_id as id,
    sum(case when r.value = 1 then 1 else 0 end)::integer as likes,
    sum(case when r.value = -1 then 1 else 0 end)::integer as dislikes
  from public.community_reactions r
  where r.post_id in (
    select pg_catalog.right(p.feed_key, 36)::uuid from page p where p.kind = 'post')
  group by r.post_id
  union all
  select
    'announcement'::text,
    r.announcement_id,
    sum(case when r.value = 1 then 1 else 0 end)::integer,
    sum(case when r.value = -1 then 1 else 0 end)::integer
  from public.community_reactions r
  where r.announcement_id in (
    select pg_catalog.right(p.feed_key, 36)::uuid from page p where p.kind = 'announcement')
  group by r.announcement_id
  union all
  select
    'comment'::text,
    r.comment_id,
    sum(case when r.value = 1 then 1 else 0 end)::integer,
    sum(case when r.value = -1 then 1 else 0 end)::integer
  from public.comment_reactions r
  where r.comment_id in (
    select pg_catalog.right(p.feed_key, 36)::uuid from page p where p.kind = 'comment')
  group by r.comment_id
)
select
  p.feed_key, p.kind, p.created_at,
  p.author_id, p.author_username, p.author_display_name, p.author_avatar,
  p.body, p.is_spoiler, p.title, p.image_url, p.link_url,
  p.clip_code, p.clip_start, p.clip_end,
  p.anime_id, p.anime_title, p.anime_cover, p.episode_number,
  p.target_url, p.reply_count,
  coalesce(x.likes, 0) as likes,
  coalesce(x.dislikes, 0) as dislikes,
  p.is_adult
from page p
left join react x
  on x.kind = p.kind
 and x.id = pg_catalog.right(p.feed_key, 36)::uuid
order by p.created_at desc, p.feed_key desc;
$function$;

revoke execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean) from public;
grant execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)
  to anon, authenticated;

-- --------------------------------------------------------------------- 4 --
-- Replies are counted by reply_count, one lookup per card. Without an index on
-- parent_id that lookup is a scan of comments for every page row.
create index if not exists comments_parent_idx
  on public.comments (parent_id)
  where parent_id is not null and deleted_at is null;

-- /community?anime=<id> (the rail links and the single-title view) narrows to one
-- anilist_id before it sorts. The plain comments_community_feed_idx still serves
-- the unfiltered arm; this one serves the filtered arm.
create index if not exists comments_anilist_feed_idx
  on public.comments (anilist_id, created_at desc, id desc)
  where deleted_at is null and parent_id is null and target_type = 'anime'
    and user_id is not null;

commit;
