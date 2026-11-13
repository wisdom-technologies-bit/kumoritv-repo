-- =====================================================================
-- Prompt 38B - rollback for docs/sql/community.sql
--
-- Does NOT undo docs/sql/profiles-rls.sql (use profiles-rls-rollback.sql,
-- and only after this file, because the community RPCs are gone by then).
--
-- ORDER MATTERS: triggers and functions first, then the comment_feed view,
-- then the comments columns, then the new tables.
--
-- WHAT IS RESTORED EXACTLY
--   * comments_guard()            -> the Prompt 10 version (10 s limit, parent
--                                    validation, frozen columns);
--   * comment_feed               -> the Prompt 10 column list;
--   * announcements read policy  -> authenticated only.
--
-- WHAT IS NOT RESTORED (documented, not an accident)
--   * notify_comment_reply / _mentions / _like keep using comment_link(),
--     which for an anime row produces '/media/<id>#comment-<id>' instead of
--     '/media/<id>'. The hash is inert on pages that do not read it, so the
--     bell keeps working; the only difference is a slightly more precise link.
--   * profiles RLS stays until profiles-rls-rollback.sql is run. That file is
--     deliberately separate.
--
-- IDEMPOTENT: safe to run twice.
--
-- VERIFY:
--   select count(*) from pg_proc where proname='community_feed_page';  -- 0
--   select count(*) from pg_class where relname like 'community\_%';   -- 0
--   select count(*) from information_schema.columns
--    where table_name='comments' and column_name in ('target_type','post_id','announcement_id'); -- 0
-- =====================================================================

-- 1. triggers + functions
drop trigger if exists community_posts_guard_trg on public.community_posts;
drop trigger if exists comments_guard_trg on public.comments;

drop function if exists public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean);
drop function if exists public.community_new_posts(timestamptz,int,uuid);
drop function if exists public.community_react(text,uuid,smallint);
drop function if exists public.comment_link(public.comments);

-- 2. the view and the guard go back to their Prompt 10 definitions
create or replace view public.comment_feed as
select c.id, c.anilist_id, c.episode_number, c.parent_id, c.user_id, c.body, c.is_spoiler,
       c.created_at, p.username, p.display_name, p.avatar_url,
       coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int as likes,
       coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int as dislikes
from public.comments c
left join public.public_profiles p on p.id = c.user_id
left join public.comment_reactions r on r.comment_id = c.id
where c.deleted_at is null
group by c.id, p.username, p.display_name, p.avatar_url;
grant select on public.comment_feed to anon, authenticated;

create or replace function public.comments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.comments c where c.user_id = new.user_id and c.created_at > now() - interval '10 seconds') then
      raise exception 'You are commenting too fast. Please wait a few seconds.';
    end if;
    if new.parent_id is not null and not exists (
      select 1 from public.comments p
      where p.id = new.parent_id and p.parent_id is null and p.anilist_id = new.anilist_id and p.deleted_at is null
    ) then
      raise exception 'Invalid reply target.';
    end if;
  else
    new.user_id := old.user_id;
    new.anilist_id := old.anilist_id;
    new.episode_number := old.episode_number;
    new.parent_id := old.parent_id;
    new.body := old.body;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists comments_guard_trg on public.comments;
create trigger comments_guard_trg before insert or update on public.comments
  for each row execute function public.comments_guard();

drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments for insert to authenticated
  with check (auth.uid() = user_id);

-- 3. announcements back to signed-in readers only
drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to authenticated using (expires_at is null or expires_at > now());
drop policy if exists "announcements insert admin" on public.announcements;
drop policy if exists "announcements update admin" on public.announcements;
drop policy if exists "announcements delete admin" on public.announcements;

-- 4. comments: drop the community columns and constraints
--    (the FK columns must go before community_posts is dropped)
alter table public.comments drop constraint if exists comments_target_chk;
alter table public.comments drop constraint if exists comments_target_type_chk;
alter table public.comments drop constraint if exists comments_body_len_chk;
drop index if exists public.comments_community_feed_idx;
drop index if exists public.comments_post_idx;
drop index if exists public.comments_announcement_idx;
alter table public.comments drop column if exists announcement_id;
alter table public.comments drop column if exists post_id;
alter table public.comments drop column if exists target_type;

-- anilist_id returns to NOT NULL only when every remaining row has one.
do $$
begin
  if not exists (select 1 from public.comments where anilist_id is null) then
    alter table public.comments alter column anilist_id set not null;
  else
    raise notice 'anilist_id stays nullable: % comment row(s) still have no anilist_id', (
      select count(*) from public.comments where anilist_id is null);
  end if;
end $$;

-- 5. the new tables
drop table if exists public.community_moderation_log;
drop table if exists public.community_blocks;
drop table if exists public.community_reports;
drop table if exists public.community_reactions;
drop table if exists public.community_posts;
drop table if exists public.staff_roles;

drop function if exists public.is_staff();
drop function if exists public.is_admin();
