-- =====================================================================
-- Prompt 38B - community Phase 1, file 1 of 2: profiles RLS
--
-- RUN THIS BEFORE docs/sql/community.sql.
--
-- WHY THIS FILE EXISTS
--   public.profiles was created without row level security. Any signed-in
--   user could `select * from public.profiles` (every row: show_adult,
--   languages, timestamps) and - worse - `update public.profiles set ...`
--   on ANY row, because there was no policy to stop them. Community puts
--   author names and roles next to profiles, so this is fixed first.
--
--   Roles are NOT stored here. They live in public.staff_roles (created by
--   file 2), which no browser role can read or write. A `profiles.role`
--   column would have been readable AND writable by any signed-in user,
--   which is a one-line privilege escalation. Do not add one.
--
-- WHAT THIS CHANGES
--   1. enables RLS on public.profiles;
--   2. a user may read / insert / update ONLY their own row (auth.uid() = id);
--   3. no delete policy at all (deletion happens through
--      admin.auth.admin.deleteUser, which cascades from auth.users);
--   4. public.public_profiles is re-declared as an owner-rights view, so the
--      four public columns (id, username, display_name, avatar_url) still
--      flow to everyone - including anon - while everything else stays
--      private. Views run as their owner, which is why the view keeps
--      working after RLS is switched on (verified by docs/sql test T3).
--
-- IDEMPOTENT: safe to run twice. Rollback: profiles-rls-rollback.sql.
--
-- HOW TO VERIFY (run after the file, in the SQL editor):
--   -- a. RLS is on and there is exactly one policy per command
--   select relrowsecurity from pg_class where oid = 'public.profiles'::regclass;
--   -- expected: t
--   select polname, cmd from pg_policies where schemaname='public' and tablename='profiles' order by 1;
--   -- expected: profiles insert own | INSERT
--   --           profiles read own   | SELECT
--   --           profiles update own | UPDATE
--   -- b. the public view still answers for anon (must return rows, not 0)
--   set local role anon; select count(*) from public.public_profiles; reset role;
--
-- ROLLBACK: docs/sql/profiles-rls-rollback.sql
-- =====================================================================

alter table public.profiles enable row level security;

-- Own row only. No policy mentions another user's id, and there is no
-- `using (true)` anywhere, so "select * from profiles" returns one row.
drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No delete policy on purpose: a browser cannot delete a profile row.
drop policy if exists "profiles delete own" on public.profiles;

-- The public read model. `security_invoker = false` is the default and is
-- written out so nobody later "fixes" it into an invoker view, which would
-- make it return nothing for anon once RLS is on.
create or replace view public.public_profiles
  with (security_invoker = false) as
  select id, username, display_name, avatar_url from public.profiles;

grant select on public.public_profiles to anon, authenticated;
