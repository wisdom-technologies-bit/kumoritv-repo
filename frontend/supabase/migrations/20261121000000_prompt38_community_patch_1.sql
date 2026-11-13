-- Mirrors docs/sql/community-patch-1.sql. Run the files OR the migrations,
-- never both: they are the same statements.

-- Prompt 38D, patch 1: review fixes to community.sql.
--
-- Run order (the owner runs these by hand, in this order):
--   1  docs/sql/profiles-rls.sql
--   2  docs/sql/community.sql
--   3  docs/sql/community-patch-1.sql        <- this file
--   4  docs/sql/comments-deleted-users.sql
--
-- Run the files OR supabase/migrations/*, never both.
--
-- Same rule as the earlier files: deploy the app code before running this,
-- because the feed RPC keeps its signature but its announcement reaction counts
-- change. This file is idempotent and safe to run against a project that already
-- has community.sql applied.
--
-- What it changes
--   1. community_feed_page(): announcement rows now count their own reactions
--      (community_reactions.announcement_id). Before, only post_id was counted,
--      so every announcement reported 0 likes and 0 dislikes.
--   2. community_feed_page(): p_show_adult is documented as a Phase 2 switch. It
--      stays in the signature so callers do not change; it does nothing yet.
--   3. The security definer functions run with an empty search_path and every
--      object schema-qualified (public.*, auth.uid()). pg_catalog is always on
--      the path, so built-ins (now, coalesce, hashtext) still resolve.
--   4. Two indexes the guard queries need, and no equivalent existed:
--        community_posts_author_created_idx (author_id, created_at desc)
--        comments_user_created_idx          (user_id, created_at desc)
--   5. community_posts_guard(): an advisory transaction lock per author, taken
--      before the rate-limit and duplicate checks, so two simultaneous inserts
--      from one account cannot both pass. The existing notify_* triggers are
--      untouched.
--   6. community_posts_feed_idx is rebuilt on (created_at desc, id desc) so the
--      index order matches the feed cursor. It cannot be built concurrently:
--      the Supabase SQL editor runs the file inside a transaction, and CREATE
--      INDEX CONCURRENTLY is not allowed there. On a large live table, take the
--      brief write lock or build it by hand outside a transaction with
--      create index concurrently community_posts_feed_idx_new ...  and then
--      rename; the plain create below is the default and is fast at this size.
--
-- Verification queries (paste into the editor afterwards)
--   select indexname from pg_indexes
--    where indexname in ('community_posts_feed_idx','community_posts_author_created_idx',
--                        'comments_user_created_idx');
--   select p.proname, p.proconfig from pg_proc p
--    where p.proname in ('community_feed_page','community_react','community_new_posts',
--                        'community_posts_guard');
--   select * from public.community_feed_page(5, null, null, 'announcement', false, null, null, true);
--   explain (analyze, buffers) select * from public.community_feed_page(20, null, null, 'all', false, null, null, true);
--   select pg_get_functiondef('public.community_posts_guard'::regproc);

begin;

-- ---------------------------------------------------------------- 1 + 2 + 3 --
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
  target_url text, reply_count integer, likes integer, dislikes integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
-- p_show_adult is accepted and ignored: adult filtering is a Phase 2 concern and
-- arrives with the episode-comment arm. It stays in the signature so the client
-- contract is stable.
with lim as (select least(greatest(coalesce(p_limit, 20), 1), 50) as n),
src as (
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
        where rc.post_id = p.id and rc.parent_id is null and rc.deleted_at is null) as reply_count
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
        where rc.announcement_id = an.id and rc.parent_id is null and rc.deleted_at is null)
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
)
select s.*,
       -- Reactions are per target: a post counts post_id, an announcement counts
       -- announcement_id. The CASE keeps the uuid cast away from rows whose
       -- subject is not a post, which would raise invalid input syntax.
       coalesce((select sum(case when r.value = 1 then 1 else 0 end)::integer
                   from public.community_reactions r
                  where (s.kind = 'post'
                         and r.post_id = pg_catalog.right(s.feed_key, 36)::uuid)
                     or (s.kind = 'announcement'
                         and r.announcement_id = pg_catalog.right(s.feed_key, 36)::uuid)), 0) as likes,
       coalesce((select sum(case when r.value = -1 then 1 else 0 end)::integer
                   from public.community_reactions r
                  where (s.kind = 'post'
                         and r.post_id = pg_catalog.right(s.feed_key, 36)::uuid)
                     or (s.kind = 'announcement'
                         and r.announcement_id = pg_catalog.right(s.feed_key, 36)::uuid)), 0) as dislikes
from src s
order by s.created_at desc, s.feed_key desc
limit (select n from lim);
$function$;

revoke execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean) from public;
grant execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)
  to anon, authenticated;

-- The other two definer functions keep their bodies; only the path changes.
alter function public.community_react(text, uuid, smallint) set search_path = '';
alter function public.community_new_posts(timestamptz, int, uuid) set search_path = '';

-- Restated, so the ACL does not depend on what earlier runs left behind.
revoke all on function public.community_react(text, uuid, smallint) from public;
revoke all on function public.community_react(text, uuid, smallint) from anon;
grant execute on function public.community_react(text, uuid, smallint) to authenticated;
revoke all on function public.community_new_posts(timestamptz, int, uuid) from public;
grant execute on function public.community_new_posts(timestamptz, int, uuid) to anon, authenticated;

-- --------------------------------------------------------------------- 4 --
create index if not exists community_posts_author_created_idx
  on public.community_posts (author_id, created_at desc);
create index if not exists comments_user_created_idx
  on public.comments (user_id, created_at desc);

-- ------------------------------------------------------------------- 5 --
CREATE OR REPLACE FUNCTION public.community_posts_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
declare
  normalised text;
begin
  if tg_op = 'INSERT' then
    -- One lock per author, held to the end of the transaction. Two tabs cannot
    -- both read "no recent post" and both insert.
    perform pg_advisory_xact_lock(hashtext(new.author_id::text));

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

    normalised := regexp_replace(lower(btrim(new.body)), '\s+', ' ', 'g');
    if exists (select 1 from public.community_posts p
                where p.author_id = new.author_id
                  and regexp_replace(lower(btrim(p.body)), '\s+', ' ', 'g') = normalised
                  and p.created_at > now() - interval '10 minutes') then
      raise exception 'You just posted that.';
    end if;

    new.body := btrim(new.body);
    if char_length(new.body) = 0 then
      raise exception 'Write something first.';
    end if;
  else
    -- Only these may move from a browser; status/pinned are staff-only and are
    -- enforced by the RLS update policy plus this freeze.
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
end $function$;

drop trigger if exists community_posts_guard_trg on public.community_posts;
create trigger community_posts_guard_trg before insert or update on public.community_posts
  for each row execute function public.community_posts_guard();

-- --------------------------------------------------------------------- 6 --
-- Cursor order is (created_at desc, id desc); the index now matches it. Plain
-- create by design: create index concurrently cannot run in the editor's
-- transaction.
drop index if exists public.community_posts_feed_idx;
create index community_posts_feed_idx
  on public.community_posts (created_at desc, id desc)
  where deleted_at is null and status = 'published';

commit;
