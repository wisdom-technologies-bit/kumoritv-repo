-- =====================================================================
-- KumoriTV Community - Phase 4 ROLLBACK
--
-- Run as ONE paste in the Supabase SQL editor, AFTER reverting the code (or
-- after deploying it with COMMUNITY_ENABLED unset, which is the safe order).
--
-- It removes exactly what community-phase-4.sql added and restores the
-- announcement policies to the shape community.sql defines. It does NOT delete
-- any announcement rows: dropping `idempotency_key` only forgets the dedupe
-- keys, and `push_sent_at` is untouched, so nothing is re-sent by this file.
--
-- Idempotent: `if exists` everywhere, safe to run twice.
-- =====================================================================

begin;

-- The new-post bar's read function (the endpoint then 500s until the next
-- deploy, which is why the code is reverted first).
drop function if exists public.community_latest(text, int);

-- The per-user new-post bar switch.
alter table public.profiles drop column if exists community_toasts;

-- The unique index first: the column cannot be dropped while it backs an index.
drop index if exists public.announcements_idempotency_key_idx;
drop index if exists public.announcements_created_at_idx;

-- The author FK (and only if this file's constraint is the one present).
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'announcements_created_by_fkey'
      and conrelid = 'public.announcements'::regclass
  ) then
    alter table public.announcements drop constraint announcements_created_by_fkey;
  end if;
end $$;

alter table public.announcements drop column if exists idempotency_key;
alter table public.announcements drop column if exists created_by;
alter table public.announcements drop column if exists updated_at;

-- Announcement policies back to the community.sql definitions. They are the same
-- rules, written again so the rollback is the last word either way.
alter table public.announcements enable row level security;

drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to anon, authenticated
  using (expires_at is null or expires_at > now());

drop policy if exists "announcements insert admin" on public.announcements;
create policy "announcements insert admin" on public.announcements
  for insert to authenticated with check (public.is_admin());

drop policy if exists "announcements update admin" on public.announcements;
create policy "announcements update admin" on public.announcements
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "announcements delete admin" on public.announcements;
create policy "announcements delete admin" on public.announcements
  for delete to authenticated using (public.is_admin());

commit;

-- Verification after rollback:
--   expect 0 rows
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'profiles'
   and column_name = 'community_toasts';

--   expect 0 rows
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'announcements'
   and column_name in ('created_by', 'idempotency_key', 'updated_at');

--   expect the four announcement policies
select policyname from pg_policies
 where schemaname = 'public' and tablename = 'announcements'
 order by policyname;
