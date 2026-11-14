-- Rollback for docs/sql/community-clips-arm.sql (Phase 3).
--
-- Run order: this is the EXACT reverse of the run order, so run it FIRST when
-- unwinding Phase 3:
--   0  docs/sql/community-clips-arm-rollback.sql   <- this file
--   1  docs/sql/community-comments-arm-rollback.sql
--   2  docs/sql/comments-deleted-users-rollback.sql
--   3  docs/sql/community-patch-1-rollback.sql
--   4  docs/sql/community-rollback.sql
--   5  docs/sql/profiles-rls-rollback.sql
--
-- What it restores, byte for byte, from the files that shipped before it:
--   * public.community_feed_page - the Phase 2 definition: same argument list,
--     OUT columns end at is_adult, there is no clip_state, a post's `title` is
--     always NULL again and an adult clip post is listed like any other clip
--     post (Phase 2 did not filter clip posts; that is what Phase 3 added).
--   * public.community_new_posts - the Prompt 38B definition: three arguments,
--     clip_code/anime_id/episode_number returned as-is with no adult gating.
--   * the partial index community_posts_clips_feed_idx is dropped.
--
-- It is idempotent: running it twice is a no-op. It never touches the five
-- earlier files and it does not delete a single row.
--
-- IMPORTANT: roll back the app FIRST. The Phase 3 client asks for clip_state;
-- after this file runs there is no such column, so a deployed Phase 3 build
-- would fall back to its error state until the Phase 2 build is deployed.

begin;

drop function if exists public.community_feed_page(integer, timestamp with time zone, text, text, boolean, uuid, bigint, boolean);

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

drop function if exists public.community_new_posts(timestamp with time zone, integer, uuid, boolean);

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
    left join public.public_profiles pr on pr.id = r.author_id
   order by r.created_at desc;
$$;

revoke execute on function public.community_new_posts(timestamptz,int,uuid) from public;
grant execute on function public.community_new_posts(timestamptz,int,uuid) to anon, authenticated;

drop index if exists public.community_posts_clips_feed_idx;

commit;
