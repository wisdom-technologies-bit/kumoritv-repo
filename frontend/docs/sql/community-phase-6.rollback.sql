-- =====================================================================
-- Community Phase 6 rollback. Restores the Phase 5 database exactly.
--
-- RUN ORDER: after docs/sql/community-phase-6.rollback.sql is needed at all,
-- run it alone (it is not part of the forward chain). Deploy the Phase 5 code
-- first, or keep the Phase 6 code: the old and new app builds both work against
-- the Phase 5 functions because the columns the Phase 6 build reads
-- (status, moderation_reason) only disappear from the feed result - a Phase 6
-- client tolerates their absence (they are optional in the type) but its
-- moderation routes stop working. Roll back the code and the SQL together.
--
-- WHAT IT DOES
--   1. Restores community_feed_page exactly as community-clips-arm.sql left it
--      (drop + create, because the OUT columns differ; ACLs restated).
--   2. Restores the comment_feed view (drop + create: a view cannot lose
--      columns with create or replace).
--   3. Restores community_new_posts.
--   4. Drops community_moderate, community_resolve_report,
--      community_dismiss_reports.
--   5. Restores the announcements SELECT policy and the moderation log's
--      constraint set.
--   6. REFUSES to drop the moderation columns while any row is hidden/removed:
--      dropping them would silently republish moderated content. If the check
--      raises, restore the affected rows first (or accept the columns staying:
--      they are inert without the Phase 6 code).
--
-- ROLLBACK OF THIS ROLLBACK: run community-phase-6.sql again. It is idempotent.
-- =====================================================================

begin;

-- 1. the feed, Phase 5 shape
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

-- 2. the comment view, Phase 5 shape
drop view if exists public.comment_feed;

create or replace view public.comment_feed as
select c.id, c.anilist_id, c.episode_number, c.parent_id, c.user_id, c.body,
       c.is_spoiler, c.created_at, p.username, p.display_name, p.avatar_url,
       coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int as likes,
       coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int as dislikes,
       c.target_type, c.post_id, c.announcement_id
from public.comments c
left join public.public_profiles p on p.id = c.user_id
left join public.comment_reactions r on r.comment_id = c.id
left join public.community_posts cp on cp.id = c.post_id
left join public.announcements an on an.id = c.announcement_id
where c.deleted_at is null
  and (c.target_type <> 'post'
       or (cp.id is not null and cp.deleted_at is null and cp.status = 'published'))
  and (c.target_type <> 'announcement'
       or (an.id is not null and (an.expires_at is null or an.expires_at > now())))
group by c.id, p.username, p.display_name, p.avatar_url;
grant select on public.comment_feed to anon, authenticated;

-- 3. the toast helper, Phase 5 shape (same signature: create or replace is fine)
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

-- 4. the Phase 6 functions
drop function if exists public.community_moderate(text, uuid, text, text);
drop function if exists public.community_resolve_report(uuid, text, text);
drop function if exists public.community_dismiss_reports(uuid[], text);

-- 5. announcements policy, Phase 5 shape
drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to anon, authenticated
  using (expires_at is null or expires_at > now());

-- The log's original vocabulary is restored in step 7 below, and only when no
-- 'clip' row exists: the log is append-only, so a rollback must never delete an
-- audit row just to fit an older constraint.

-- 6. indexes
drop index if exists public.community_posts_status_idx;
drop index if exists public.comments_status_idx;
drop index if exists public.clips_hidden_idx;
drop index if exists public.community_reports_target_idx;

-- 7. columns. Guarded: never silently republish moderated content.
do $$
declare
  v_bad bigint;
begin
  select
    (select count(*) from public.community_posts where status <> 'published')
  + (select count(*) from public.comments where status <> 'published')
  + (select count(*) from public.announcements where status <> 'published')
  + (select count(*) from public.clips where hidden_at is not null)
  into v_bad;
  if v_bad > 0 then
    raise exception
      'Refusing to roll back: % rows are hidden or removed. Restore them with community_moderate first, or leave the (inert) columns in place.',
      v_bad;
  end if;
end $$;

-- 7b. the log's constraint set. The kind list keeps 'clip': the log is
-- append-only, so a clip row written before the rollback cannot be deleted to
-- fit an older constraint. Keeping the value is inert for the Phase 5 code and
-- loses no audit trail; deleting rows to match a constraint would.
alter table public.community_moderation_log
  drop constraint if exists community_moderation_log_target_kind_chk;
alter table public.community_moderation_log
  drop constraint if exists community_moderation_log_target_kind_check;
alter table public.community_moderation_log
  add constraint community_moderation_log_target_kind_check
  check (target_kind in ('post','comment','announcement','profile','clip'));
alter table public.community_moderation_log
  drop constraint if exists community_moderation_log_action_chk;
alter table public.community_moderation_log
  add constraint community_moderation_log_action_check
  check (action in ('hide','unhide','remove','restore','role_change'));

alter table public.comments drop constraint if exists comments_status_chk;
alter table public.comments
  drop column if exists status,
  drop column if exists removed_reason,
  drop column if exists moderated_at,
  drop column if exists moderated_by;

alter table public.announcements drop constraint if exists announcements_status_chk;
alter table public.announcements
  drop column if exists status,
  drop column if exists removed_reason,
  drop column if exists moderated_at,
  drop column if exists moderated_by;

alter table public.community_posts
  drop column if exists moderated_at,
  drop column if exists moderated_by;

alter table public.clips
  drop column if exists hidden_at,
  drop column if exists moderated_at,
  drop column if exists moderated_by;

alter table public.community_reports drop constraint if exists community_reports_note_len;
alter table public.community_reports drop column if exists resolution_note;

commit;

-- =====================================================================
-- 12. part B: the report inbox
-- =====================================================================
drop function if exists public.community_report_groups(text, text, text, int, bigint, timestamptz, uuid);
drop function if exists public.community_clip_report_groups(text, int, bigint, timestamptz, uuid);
drop function if exists public.community_moderation_stats();
drop function if exists public.community_moderation_queue(text, int, timestamptz, uuid);
drop function if exists public.community_resolve_clip_reports(uuid[], text);

alter table public.clip_reports drop constraint if exists clip_reports_status_chk;
drop index if exists public.clip_reports_open_idx;
alter table public.clip_reports drop column if exists resolved_by;
alter table public.clip_reports drop column if exists resolved_at;
alter table public.clip_reports drop column if exists status;

-- 13. part C: block guards
drop trigger if exists community_blocked_push_guard on public.push_outbox;
drop trigger if exists community_blocked_notification_guard on public.user_notifications;
drop function if exists public.community_blocked_push_guard();
drop function if exists public.community_blocked_notification_guard();
