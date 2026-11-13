-- Rollback for docs/sql/community-comments-arm.sql.
--
-- Restores community_feed_page() to exactly the definition community-patch-1.sql
-- left behind (two arms: post, announcement), drops the two indexes this phase
-- added, and puts the ACLs back. The signature was never changed, so the app
-- code keeps working: it simply stops receiving comment cards.
--
-- Run order: this undoes step 5 only. Steps 1-4 stay applied. Run this file OR
-- the migrations, never both. Idempotent: running it twice is a no-op.
--
-- Verification queries
--   select pg_get_function_result('public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure)
--     like '%is_adult%';                                    -- expect f
--   select count(*) from pg_indexes
--    where indexname in ('comments_parent_idx','comments_anilist_feed_idx');  -- expect 0
--   select * from public.community_feed_page(5, null, null, 'comment', false, null, null, true); -- empty

begin;

-- Same reason as the forward file: the OUT columns change, so the function is
-- dropped and recreated inside this transaction.
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

-- The two indexes Phase 2 added. comments_community_feed_idx and
-- comments_user_created_idx belong to earlier files and are left alone.
drop index if exists public.comments_anilist_feed_idx;
drop index if exists public.comments_parent_idx;

commit;
