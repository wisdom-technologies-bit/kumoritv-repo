-- =====================================================================
-- Prompt 38B - rollback for docs/sql/profiles-rls.sql
--
-- Undoes ONLY the profiles hardening. It does not touch any community
-- table (use community-rollback.sql for that).
--
-- WHAT IT DOES
--   drops the three own-row policies, turns RLS off again on public.profiles
--   (back to the pre-38B state), and re-creates public_profiles as a plain
--   view so no option is left behind.
--
-- IDEMPOTENT: safe to run twice.
--
-- VERIFY:
--   select relrowsecurity from pg_class where oid='public.profiles'::regclass;
--   -- expected: f
--   select count(*) from pg_policies where schemaname='public' and tablename='profiles';
--   -- expected: 0
-- =====================================================================

drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;

alter table public.profiles disable row level security;

create or replace view public.public_profiles as
  select id, username, display_name, avatar_url from public.profiles;

grant select on public.public_profiles to anon, authenticated;
