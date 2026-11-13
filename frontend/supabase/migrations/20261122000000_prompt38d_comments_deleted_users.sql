-- Mirrors docs/sql/comments-deleted-users.sql. Run the files OR the
-- migrations, never both: they are the same statements.

-- Prompt 38D, commit B: account deletion keeps the conversation readable.
--
-- Run order (by hand, in the Supabase SQL editor):
--   1  docs/sql/profiles-rls.sql
--   2  docs/sql/community.sql
--   3  docs/sql/community-patch-1.sql
--   4  docs/sql/comments-deleted-users.sql   <- this file
--
-- Run the files OR supabase/migrations/*, never both.
--
-- What it changes
--   1. comments.user_id may be NULL, and its foreign key to auth.users becomes
--      ON DELETE SET NULL instead of ON DELETE CASCADE.
--   2. public.anonymise_user_comments(p_user uuid): security definer, search_path
--      empty, executable by service_role only. One transaction that
--        - deletes the user's community posts (their comments go with them),
--        - deletes their reactions (community and comment), reports, blocks,
--          notifications and push outbox rows,
--        - keeps a comment ONLY when other people replied to it: user_id becomes
--          NULL and the body becomes '[deleted]'; a comment with no replies is
--          removed. Nothing left in a kept row identifies the person.
--   3. comments_guard(): unchanged behaviour, but the 10-second rule is skipped
--      when user_id is null, because a deleted author is not a live account.
--   4. comment_feed: one column added at the end, is_deleted_author. Every
--      existing column keeps its name and position, so every reader still works.
--
-- Why the work is in a function called by the API instead of a trigger on
-- auth.users: a BEFORE DELETE trigger on the auth schema cannot be created from
-- the SQL editor in most Supabase projects (no rights on that schema), and a
-- trigger could not tell "replied to" from "orphan" without the same statements.
-- /api/account/delete calls this function first and only then deletes the user,
-- so the FK's ON DELETE SET NULL is the safety net rather than the mechanism.
--
-- Re-compare against production before running (Paste the output in the PR if it
-- differs from community.sql):
--   select pg_get_functiondef('public.comments_guard'::regproc);
--   select pg_get_functiondef('public.comment_feed'::regproc);   -- if it is ever a function
--
-- Verification afterwards
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'comments' and column_name = 'user_id';            -- YES
--   select confdeltype from pg_constraint where conname = 'comments_user_id_fkey';  -- n (set null)
--   select has_function_privilege('authenticated','public.anonymise_user_comments(uuid)','execute'); -- false
--   select has_function_privilege('service_role','public.anonymise_user_comments(uuid)','execute');  -- true
--   select count(*) from public.comments where user_id is null and body <> '[deleted]';              -- 0
--   select * from public.comment_feed limit 5;

begin;

-- --------------------------------------------------------------------- 1 --
alter table public.comments alter column user_id drop not null;

alter table public.comments drop constraint if exists comments_user_id_fkey;
alter table public.comments
  add constraint comments_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- --------------------------------------------------------------------- 2 --
CREATE OR REPLACE FUNCTION public.anonymise_user_comments(p_user uuid)
RETURNS TABLE(kept integer, removed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
declare
  kept_count integer := 0;
  removed_count integer := 0;
begin
  if p_user is null then
    raise exception 'anonymise_user_comments needs a user id.';
  end if;

  -- A comment survives only if somebody replied to it. Replies that nobody
  -- answered are removed too: nothing in them is still being referred to.
  with doomed as (
    delete from public.comments c
     where c.user_id = p_user
       and not exists (
         select 1 from public.comments r
          where r.parent_id = c.id and r.deleted_at is null)
    returning 1
  )
  select count(*) into removed_count from doomed;

  with kept_rows as (
    update public.comments c
       set user_id = null,
           body = '[deleted]',
           is_spoiler = false,
           updated_at = pg_catalog.now()
     where c.user_id = p_user
    returning 1
  )
  select count(*) into kept_count from kept_rows;

  -- Everything else of theirs goes. Posts first: their comments cascade.
  delete from public.community_posts p where p.author_id = p_user;
  delete from public.community_reactions r where r.user_id = p_user;
  delete from public.comment_reactions r where r.user_id = p_user;
  delete from public.community_reports r where r.reporter_id = p_user;
  delete from public.community_blocks b where b.blocker_id = p_user or b.blocked_id = p_user;
  delete from public.user_notifications n where n.user_id = p_user;
  delete from public.push_outbox o where o.user_id = p_user;

  return query select kept_count, removed_count;
end $function$;

revoke all on function public.anonymise_user_comments(uuid) from public;
revoke all on function public.anonymise_user_comments(uuid) from anon;
revoke all on function public.anonymise_user_comments(uuid) from authenticated;
grant execute on function public.anonymise_user_comments(uuid) to service_role;

-- --------------------------------------------------------------------- 3 --
create or replace function public.comments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- ORIGINAL BEHAVIOUR 1: one comment per user per 10 seconds, site-wide.
    -- Skipped for a null user: a deleted author is not an account that can post.
    if new.user_id is not null and exists (
      select 1 from public.comments c
       where c.user_id = new.user_id and c.created_at > now() - interval '10 seconds'
    ) then
      raise exception 'You are commenting too fast. Please wait a few seconds.';
    end if;

    -- ORIGINAL BEHAVIOUR 2: a reply must point at a live top-level comment of
    -- the same thing (anime -> same anilist_id; post/announcement -> same id).
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
    -- ORIGINAL BEHAVIOUR 3: only is_spoiler / deleted_at may move; every other
    -- column is frozen, and updated_at is stamped. user_id is still frozen, so
    -- a browser cannot re-attribute an anonymised comment to somebody else.
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

-- --------------------------------------------------------------------- 4 --
-- Column list unchanged; is_deleted_author is appended, so `select *` readers
-- that read by name or by ordinal prefix are unaffected.
create or replace view public.comment_feed as
select c.id, c.anilist_id, c.episode_number, c.parent_id, c.user_id, c.body,
       c.is_spoiler, c.created_at, p.username, p.display_name, p.avatar_url,
       coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int as likes,
       coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int as dislikes,
       c.target_type, c.post_id, c.announcement_id,
       (c.user_id is null) as is_deleted_author
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

commit;
