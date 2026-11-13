-- Rollback for docs/sql/community-patch-1.sql.
--
-- Restores exactly the state after docs/sql/community.sql: the feed RPC that
-- counts only post reactions, the guard without the advisory lock, the old feed
-- index order, and the public search_path on the two definer functions. The two
-- additive indexes are dropped because community.sql does not create them.
--
-- Verification afterwards:
--   select p.proname, p.proconfig from pg_proc p
--    where p.proname in ('community_feed_page','community_react','community_new_posts');
--   select indexdef from pg_indexes where indexname = 'community_posts_feed_idx';
--   select pg_get_functiondef('public.community_posts_guard'::regproc);

begin;

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
SET search_path = public
AS $function$
with lim as (select least(greatest(coalesce(p_limit, 20), 1), 50) as n),
src as (
  (
    select
      'post:' || p.id::text as feed_key,
      'post'::text as kind,
      p.created_at, p.author_id,
      pr.username::text, pr.display_name::text, pr.avatar_url::text,
      case when p.is_spoiler then null else p.body end,
      p.is_spoiler, null::text, null::text, p.link_url,
      cl.code::text, cl.start_seconds, cl.end_seconds, cl.anilist_id,
      coalesce(a.title_english, a.title)::text, a.cover_url::text, cl.episode_number,
      '/community/post/' || p.id::text,
      (select count(*)::int from public.comments rc
        where rc.post_id = p.id and rc.parent_id is null and rc.deleted_at is null)
    from public.community_posts p
    left join public.public_profiles pr on pr.id = p.author_id
    left join public.clips cl on cl.id = p.clip_id and cl.deleted_at is null
    left join public.anime a on a.anilist_id = cl.anilist_id
    where p.deleted_at is null and p.status = 'published'
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
    order by p.created_at desc, feed_key desc
    limit (select n from lim)
  )
  union all
  (
    select
      'announcement:' || an.id::text, 'announcement'::text, an.created_at,
      null::uuid, null::text, 'KumoriTV'::text, null::text, an.body, false,
      an.title, an.image, an.url,
      null::text, null::numeric, null::numeric,
      null::bigint, null::text, null::text, null::int,
      '/community/announcements/' || an.id::text,
      (select count(*)::int from public.comments rc
        where rc.announcement_id = an.id and rc.parent_id is null and rc.deleted_at is null)
    from public.announcements an
    where (an.expires_at is null or an.expires_at > now())
      and p_kind in ('all','announcement')
      and p_author is null and p_anilist_id is null
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
                  where r.post_id = case when s.kind = 'post'
                                         then substring(s.feed_key from 6)::uuid end), 0) as likes,
       coalesce((select sum(case when r.value = -1 then 1 else 0 end)::int
                   from public.community_reactions r
                  where r.post_id = case when s.kind = 'post'
                                         then substring(s.feed_key from 6)::uuid end), 0) as dislikes
from src s
order by s.created_at desc, s.feed_key desc
limit (select n from lim);
$function$;

alter function public.community_react(text, uuid, smallint) set search_path = public;
alter function public.community_new_posts(timestamptz, int, uuid) set search_path = public;

CREATE OR REPLACE FUNCTION public.community_posts_guard()
RETURNS trigger LANGUAGE plpgsql AS $function$
declare
  normalised text;
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

drop index if exists public.community_posts_feed_idx;
create index community_posts_feed_idx
  on public.community_posts (created_at desc, id)
  where deleted_at is null and status = 'published';

drop index if exists public.community_posts_author_created_idx;
drop index if exists public.comments_user_created_idx;

commit;
