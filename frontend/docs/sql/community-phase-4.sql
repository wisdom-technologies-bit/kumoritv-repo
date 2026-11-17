-- =====================================================================
-- KumoriTV Community - Phase 4
--
-- RUN THIS IN THE SUPABASE SQL EDITOR AS ONE PASTE, **BEFORE** DEPLOYING
-- THE PHASE 4 CODE.
--
-- The code expects these columns to exist:
--   profiles.community_toasts
--   announcements.updated_at, announcements.created_by,
--   announcements.idempotency_key (with a unique index)
-- and the admin write policies on `announcements` re-asserted.
--
-- This file is idempotent: every statement is `if not exists`, every policy is
-- dropped before it is created, and the constraint is added inside a DO block
-- that checks pg_constraint. Running it twice is a no-op the second time.
--
-- It does NOT touch any existing community SQL file, and it does not replace
-- any function (so the "never CREATE OR REPLACE a function with a different
-- return type" lesson cannot bite here).
--
-- ROLLBACK: docs/sql/community-phase-4.rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The per-user switch for the new-post bar.
--
-- Default TRUE: the bar is on for everyone who never touches the setting, which
-- is what the owner asked for. Guests and signed-out readers keep their choice
-- in localStorage only; the server column is the source of truth once signed in.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists community_toasts boolean not null default true;

-- ---------------------------------------------------------------------
-- 2. Announcements: the three columns the composer needs.
--
--   updated_at        - an edit is visible in the admin list
--   created_by        - who wrote it (audit, and the "Written by" future)
--   idempotency_key   - one UUID per compose attempt, so a double click loses
--                       the race in Postgres instead of creating a second row
-- ---------------------------------------------------------------------
alter table public.announcements
  add column if not exists updated_at timestamptz not null default now();

alter table public.announcements
  add column if not exists created_by uuid;

alter table public.announcements
  add column if not exists idempotency_key uuid;

-- The author FK, added only if it is not already there.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'announcements_created_by_fkey'
      and conrelid = 'public.announcements'::regclass
  ) then
    alter table public.announcements
      add constraint announcements_created_by_fkey
      foreign key (created_by) references auth.users (id) on delete set null;
  end if;
end $$;

-- Existing rows: created_at is the best guess for "last changed".
update public.announcements
   set updated_at = created_at
 where updated_at is null;

-- One announcement per compose attempt. Partial, because the column is null for
-- every row written before this phase (and for anything inserted by hand in the
-- Table Editor, which is still allowed).
create unique index if not exists announcements_idempotency_key_idx
  on public.announcements (idempotency_key)
  where idempotency_key is not null;

-- The admin list and the "recent" panel read newest first.
create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);

-- ---------------------------------------------------------------------
-- 3. The read behind GET /api/community/latest (the new-post bar).
--
-- One function, so the public rules live in the same place the feed keeps them:
-- only `published` and undeleted posts (the table's status check allows
-- published/hidden/removed - there is no 'visible' value in this schema),
-- only announcements that are unexpired, a spoiler body replaced by the word
-- "Spoiler", a [deleted] author named as such, and NOTHING of an adult clip
-- except the fact that it is adult: the thumbnail is nulled here as well as in
-- the route, because this payload is shared by everyone.
--
-- Dropped before it is created: that is both idempotent and the only way to
-- avoid the "CREATE OR REPLACE with a different return type" failure if the
-- column list ever changes.
-- ---------------------------------------------------------------------
drop function if exists public.community_latest(text, int);

create function public.community_latest(
  p_after text default null,
  p_limit int default 5
) returns table (
  id text,
  kind text,
  created_at timestamptz,
  author_id uuid,
  author_name text,
  author_avatar text,
  text text,
  has_clip boolean,
  clip_thumb text,
  adult boolean,
  href text
)
language sql stable security definer set search_path = public as $$
with lim as (select least(greatest(coalesce(p_limit, 5), 1), 10) as n),
cut as (select case when p_after is null or p_after = '' then null else p_after::timestamptz end as ts)
select * from (
  -- ------------------------------ posts ------------------------------
  (
    select
      p.id::text,
      'post'::text,
      p.created_at,
      p.author_id,
      case
        when p.author_id is null then null
        else coalesce(pr.display_name, pr.username, '[deleted]')
      end::text as author_name,
      pr.avatar_url::text,
      case when p.is_spoiler then 'Spoiler'::text else p.body end::text as text,
      (cl.id is not null) as has_clip,
      case when coalesce(a.is_adult, false) then null else a.cover_url::text end as clip_thumb,
      coalesce(a.is_adult, false) as adult,
      ('/community/post/' || p.id::text)::text as href
    from public.community_posts p
    left join public.public_profiles pr on pr.id = p.author_id
    left join public.clips cl on cl.id = p.clip_id and cl.deleted_at is null
    left join public.anime a on a.anilist_id = cl.anilist_id
    where p.deleted_at is null
      and p.status = 'published'
      and (select ts from cut) is not null
      and p.created_at > (select ts from cut)
    order by p.created_at desc, p.id desc
    limit (select n from lim)
  )
  union all
  -- -------------------------- announcements --------------------------
  (
    select
      an.id::text,
      'announcement'::text,
      an.created_at,
      null::uuid,
      'KumoriTV'::text,
      null::text,
      an.body::text,
      false,
      null::text,
      false,
      ('/community/announcements/' || an.id::text)::text
    from public.announcements an
    where (an.expires_at is null or an.expires_at > now())
      and (select ts from cut) is not null
      and an.created_at > (select ts from cut)
    order by an.created_at desc, an.id desc
    limit (select n from lim)
  )
) rows
order by rows.created_at desc, rows.id desc
limit (select n from lim);
$$;

-- The endpoint is the one thing anon must be able to read.
grant execute on function public.community_latest(text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS, re-asserted.
--
-- Same rules as community.sql, written again so this file is the last word on
-- who may write an announcement. The API uses the CALLER's session, so these
-- policies are the second gate behind is_admin().
--
-- is_admin() is security definer over public.staff_roles: a browser role cannot
-- read staff_roles, and a user cannot make themselves an admin by writing to
-- their own profile row (staff_roles is a separate table with no write policy).
-- ---------------------------------------------------------------------
alter table public.announcements enable row level security;

drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to anon, authenticated
  using (expires_at is null or expires_at > now());

drop policy if exists "announcements insert admin" on public.announcements;
create policy "announcements insert admin" on public.announcements
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "announcements update admin" on public.announcements;
create policy "announcements update admin" on public.announcements
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "announcements delete admin" on public.announcements;
create policy "announcements delete admin" on public.announcements
  for delete to authenticated
  using (public.is_admin());

-- Table privileges: browsers may read, and may write through the API (RLS still
-- decides). Nothing here grants anything is_admin() does not already require.
grant select on public.announcements to anon, authenticated;
grant insert, update, delete on public.announcements to authenticated;

-- profiles: the existing "profiles update own" policy (docs/sql/profiles-rls.sql)
-- is reused unchanged - it is `auth.uid() = id` on both USING and WITH CHECK, so
-- a user can only ever touch their own row. It is column-agnostic, which is
-- correct here because `community_toasts` is a personal preference.
--
-- WHAT TO CHECK BEFORE MERGING (run step 5 below): list the profiles columns. If
-- the table ever gains a privileged column (role, plan, is_admin, credits, ...)
-- then that policy becomes too broad and the UPDATE grant must be narrowed to
-- the personal columns. Nothing in this phase adds such a column.

commit;

-- =====================================================================
-- 5. Verification - every query must return the expected value
-- =====================================================================

-- 5a. The flag column exists, is NOT NULL and defaults to true.
--     Expect: is_nullable = NO, column_default = true
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'profiles'
   and column_name = 'community_toasts';

-- 5b. The announcement columns exist.
--     Expect three rows: created_by, idempotency_key, updated_at
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'announcements'
   and column_name in ('created_by', 'idempotency_key', 'updated_at')
 order by column_name;

-- 5c. The unique index on the idempotency key exists.
--     Expect one row: announcements_idempotency_key_idx
select indexname
  from pg_indexes
 where schemaname = 'public'
   and tablename = 'announcements'
   and indexname = 'announcements_idempotency_key_idx';

-- 5d. The four announcement policies are exactly as intended.
--     Expect four rows, each with the expected command.
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename = 'announcements'
 order by policyname;

-- 5e. The staff gate still resolves to a boolean for a browser session.
--     Expect: false (no session in the SQL editor)
select public.is_admin();

-- 5g. The latest-feed function exists, is security definer and anon can run it.
--     Expect one row: prosecdef = true, has_function_privilege = true
select p.prosecdef as security_definer,
       has_function_privilege('anon', 'public.community_latest(text,int)', 'execute') as anon_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'community_latest';

-- 5f. Every profile column, so step "profiles update own" can be re-checked.
--     Nothing here should be privileged; if something is, narrow the grant.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'profiles'
 order by ordinal_position;

-- =====================================================================
-- 6. Optional hardening (NOT run by this file, opt-in only)
--
-- If 5f lists a column a user must never change (a role, a plan, credits), the
-- `profiles update own` policy - which is row-scoped but column-agnostic - has
-- to be narrowed. Uncomment, review the column list, then run:
--
--   revoke update on public.profiles from authenticated;
--   grant update (display_name, avatar_url, show_adult, community_toasts)
--     on public.profiles to authenticated;
--
-- Adding a column to that list later requires the same one-line grant, which is
-- why it is not done by default.
-- =====================================================================
