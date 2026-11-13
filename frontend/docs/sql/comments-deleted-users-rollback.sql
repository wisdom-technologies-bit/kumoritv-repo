-- Rollback for docs/sql/comments-deleted-users.sql.
--
-- Order matters: anonymised rows cannot satisfy NOT NULL, and the CASCADE foreign
-- key is the only thing that removes them. This rollback therefore deletes the
-- anonymised comments (user_id is null - by construction they are exactly the
-- rows this feature created) and then restores the constraint.
--
-- Verify afterwards:
--   select is_nullable from information_schema.columns
--    where table_name='comments' and column_name='user_id';           -- NO
--   select confdeltype from pg_constraint where conname='comments_user_id_fkey';  -- c
--   select count(*) from pg_proc where proname='anonymise_user_comments';          -- 0
--   select count(*) from public.comments where user_id is null;                    -- 0

begin;

-- Authorless rows cannot satisfy NOT NULL, and a row pointing at a deleted auth
-- user cannot satisfy the restored foreign key.
delete from public.comments c
 where c.user_id is null
    or not exists (select 1 from auth.users u where u.id = c.user_id);

alter table public.comments drop constraint if exists comments_user_id_fkey;
alter table public.comments
  add constraint comments_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.comments alter column user_id set not null;

drop function if exists public.anonymise_user_comments(uuid);

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

-- comment_feed was never changed, so there is nothing to restore here.

commit;
