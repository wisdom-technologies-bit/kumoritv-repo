-- Prompt 38F, Community Phase 3: the clip arm of the feed, and the adult rule.
--
-- Run order (the owner runs these by hand, in this order):
--   1  docs/sql/profiles-rls.sql
--   2  docs/sql/community.sql
--   3  docs/sql/community-patch-1.sql
--   4  docs/sql/comments-deleted-users.sql
--   5  docs/sql/community-comments-arm.sql
--   6  docs/sql/community-clips-arm.sql          <- this file
--
-- Run the files OR supabase/migrations/*, never both. The five earlier files are
-- not edited by this one; it only replaces two functions and adds one index.
--
-- DEPLOY ORDER FOR THIS PHASE: run this SQL BEFORE deploying the Phase 3 code.
--   * community_feed_page gains one OUT column (clip_state) at the END. The
--     Phase 3 client reads it; the Phase 2 client ignores trailing columns, so a
--     Phase 2 deployment keeps working after the file runs. The reverse is not
--     true: the Phase 3 client asks for clip_state, which does not exist until
--     this file has run.
--   * community_new_posts is NOT called by any deployed client yet (Phase 4),
--     so it can only be called by hand; the order there is irrelevant.
--
-- What it changes
--   1. community_feed_page(): the posts arm now knows about the clip attached to
--      a post and reports a new last column `clip_state`:
--        'none'          no clip on the post
--        'live'          a live clip is attached (nothing is deleted)
--        'removed'       clip_id is set but the clip is soft-deleted or gone
--        'hidden_adult'  the clip is live, its anime is adult, and the caller
--                        passed p_show_adult = false
--      The CLIP DATA IS NULLED IN SQL, not hidden with CSS. For 'hidden_adult'
--      clip_code, clip_start, clip_end, anime_id, anime_title, anime_cover,
--      episode_number and title are all NULL and only is_adult = true survives,
--      which is exactly what the neutral "Adult content 18+" card needs. For
--      'removed' the clip columns are NULL too, because there is nothing to
--      point at. A client that ignores clip_state still cannot leak what the
--      server did not send.
--   2. community_feed_page(): for a live clip the clip's own title travels in
--      the (previously always-null) `title` column of a post row.
--   3. community_feed_page(): p_kind = 'clips' returns only posts that have a
--      clip attached, in any of the three clip states, so the "Clips" filter
--      never promises a card it cannot draw.
--   4. Everything else is unchanged: the comment arm, announcements, the cursor
--      (created_at, feed_key), the reaction counts, the blocked-author check and
--      the comment-arm adult filter behave exactly as they did in Phase 2.
--   5. community_new_posts() gains p_show_adult at the END (default false) and
--      stops exposing an adult clip: has_clip stays true, clip_code / anime_id /
--      episode_number are NULL and the snippet is the generic 'Shared a clip'.
--      The toast itself is Phase 4; this makes the data it will read safe now.
--   6. One partial index for the clips filter. See the note at the bottom.
--
-- THE ADULT RULE, stated once
--   `anime.is_adult` (which covers the Hentai genre) means adult. An adult clip
--   is labelled "Adult content 18+" and its preview is visible only to a caller
--   whose adult-content preference is on: the signed-in profile's show_adult,
--   else the is_adult_content_enabled cookie, else false - guests are always
--   false. This is the site's EXISTING display preference, the same switch that
--   has always governed adult titles elsewhere. It is NOT age verification, NOT
--   an authorization boundary and NOT a legal gate: /media/<id> is reachable
--   either way, /clip/<code> is reachable either way, and the RPC is granted to
--   anon. It decides what is drawn in the feed, nothing more.
--
-- Verification queries (paste into the editor afterwards)
--   -- the new column is last, everything before it unchanged:
--   select pg_get_function_result(
--     'public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure);
--   -- security definer + empty search_path:
--   select proname, prosecdef, proconfig from pg_proc
--    where proname in ('community_feed_page','community_new_posts');
--   -- the ACLs are restated:
--   select has_function_privilege('anon',
--     'public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)', 'execute'),
--          has_function_privilege('authenticated',
--     'public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)', 'execute');
--   -- one clip per state, by hand:
--   select feed_key, clip_state, clip_code, anime_id, anime_title, episode_number, title, is_adult
--     from public.community_feed_page(20, null, null, 'clips', false, null, null, true);
--   -- the same page as a viewer whose setting is on:
--   select feed_key, clip_state, clip_code, anime_id, anime_title, episode_number, title, is_adult
--     from public.community_feed_page(20, null, null, 'clips', true, null, null, true);
--   explain (analyze, buffers)
--     select * from public.community_feed_page(20, null, null, 'clips', false, null, null, true);
--   select indexname from pg_indexes where indexname = 'community_posts_clips_feed_idx';

begin;

-- --------------------------------------------------------------------- 1 + 2 --
-- One OUT column is added at the end, and CREATE OR REPLACE cannot change a
-- function's OUT columns, so the function is dropped and recreated inside this
-- file's single transaction (the same technique Phase 2 used): concurrent
-- callers block on the lock and then see the new definition, never a missing
-- function. Nothing references it by oid; the ACLs are restated below anyway.
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
  is_adult boolean,
  clip_state text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
-- p_show_adult is a display preference, not an authorization boundary: it only
-- decides whether an adult clip is drawn or replaced by a neutral card, exactly
-- like the profile/cookie switch the rest of the site already honours. Guests
-- always pass false. When it is false the clip data is not sent at all.
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
  -- The clip join has NO deleted_at predicate: a post whose clip was deleted
  -- must come back as 'removed', not as a post that never had one. `live` is the
  -- deleted_at test, done once, in cs.
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
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.title::text
      end as title,
      null::text as image_url,
      p.link_url,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.code::text
      end as clip_code,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.start_seconds
      end as clip_start,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.end_seconds
      end as clip_end,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.anilist_id
      end as anime_id,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else coalesce(a.title_english, a.title)::text
      end as anime_title,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else a.cover_url::text
      end as anime_cover,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.episode_number
      end as episode_number,
      '/community/post/' || p.id::text as target_url,
      (select count(*)::integer from public.comments rc
        where rc.post_id = p.id and rc.parent_id is null and rc.deleted_at is null) as reply_count,
      -- A removed or absent clip has nothing to label; a live adult clip stays
      -- labelled true even while its preview is withheld.
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null then false
        else coalesce(a.is_adult, false)
      end as is_adult,
      case
        when p.clip_id is null then 'none'
        when cl.id is null or cl.deleted_at is not null then 'removed'
        when not p_show_adult and coalesce(a.is_adult, false) then 'hidden_adult'
        else 'live'
      end as clip_state
    from public.community_posts p
    left join public.public_profiles pr on pr.id = p.author_id
    left join public.clips cl on cl.id = p.clip_id
    left join public.anime a on a.anilist_id = cl.anilist_id
    where p.deleted_at is null
      and p.status = 'published'
      -- 'clips' is posts only, and only the ones that carry a clip (any state).
      and (
        p_kind in ('all','post')
        or (p_kind = 'clips' and p.clip_id is not null)
      )
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
      false,
      null::text
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
      coalesce(a.is_adult, false),
      null::text
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
  p.is_adult,
  p.clip_state
from page p
left join react x
  on x.kind = p.kind
 and x.id = pg_catalog.right(p.feed_key, 36)::uuid
order by p.created_at desc, p.feed_key desc;
$function$;

revoke execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean) from public;
grant execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)
  to anon, authenticated;

-- ------------------------------------------------------------------------ 5 --
-- p_show_adult is appended at the END with a default, so every existing call
-- with three arguments keeps resolving to this function. The old three-argument
-- function has to go first: leaving it in place would make `community_new_posts()`
-- ambiguous, and an ambiguous call is an error, not a fallback.
drop function if exists public.community_new_posts(timestamp with time zone, integer, uuid);

create or replace function public.community_new_posts(
  p_after timestamptz default null,
  p_limit int default 5,
  p_exclude_author uuid default null,
  p_show_adult boolean default false
) returns table (
  id uuid, created_at timestamptz,
  author_name text, author_avatar text,
  snippet text, has_clip boolean, clip_code text,
  anime_id bigint, episode_number int,
  total bigint
)
language sql stable security definer set search_path = '' as $$
  with rows as (
    select p.id, p.created_at, p.author_id, p.body, p.is_spoiler, p.clip_id,
           cl.code as clip_code, cl.anilist_id, cl.episode_number,
           -- The adult rule, applied to the data instead of to a thumbnail:
           -- nothing that identifies an adult clip leaves this function until
           -- the caller says their adult setting is on.
           (cl.id is not null and coalesce(a.is_adult, false)
             and not coalesce(p_show_adult, false)) as clip_hidden
      from public.community_posts p
      left join public.clips cl
        on cl.id = p.clip_id and cl.deleted_at is null
      left join public.anime a on a.anilist_id = cl.anilist_id
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
         case
           when r.clip_hidden then 'Shared a clip'::text
           when r.is_spoiler then 'Spoiler post'::text
           else pg_catalog.left(r.body, 120)
         end,
         (r.clip_id is not null),
         case when r.clip_hidden then null::text else r.clip_code::text end,
         case when r.clip_hidden then null::bigint else r.anilist_id end,
         case when r.clip_hidden then null::int else r.episode_number end,
         (select count(*) from public.community_posts p2
           where p2.deleted_at is null and p2.status = 'published'
             and (p_after is null or p2.created_at > p_after)
             and (p_exclude_author is null or p2.author_id <> p_exclude_author))
    from rows r
    left join public.public_profiles pr on pr.id = r.author_id
   order by r.created_at desc;
$$;

revoke execute on function public.community_new_posts(timestamptz,int,uuid,boolean) from public;
grant execute on function public.community_new_posts(timestamptz,int,uuid,boolean) to anon, authenticated;

-- ------------------------------------------------------------------------ 6 --
-- The 'clips' filter is `clip_id is not null` plus the normal "published and not
-- deleted" predicate, sorted by (created_at desc, id desc). None of the existing
-- indexes serve that: community_posts_feed_idx has no clip predicate (so the arm
-- would read every post and discard the ones without a clip) and
-- community_posts_clip_idx is keyed on clip_id alone (no sort order). This
-- partial index matches the arm exactly. The harness measures both before and
-- after on a 50k-post / 5k-clip table.
create index if not exists community_posts_clips_feed_idx
  on public.community_posts (created_at desc, id desc)
  where clip_id is not null and deleted_at is null and status = 'published';

commit;
