-- Prompt 35 - link-based clips
-- ============================================================================
-- WHAT A CLIP IS
--   A clip is a POINTER to a time range of an episode. Playing one plays that
--   range of the normal stream (`/clip/{code}` or
--   `/watch/{id}?ep={n}&t={start}&end={end}`). No video file is cut, stored,
--   downloaded or re-uploaded: there is no ffmpeg, no bucket, no copy of the
--   episode anywhere. That is deliberate (hosting cost + takedown exposure).
--
-- RLS AND ACCESS - the choice, explained
--   RLS is ENABLED on both tables.
--     * public.clips: one SELECT policy lets a signed-in user read their OWN
--       rows. That mirrors the rest of the repo, where the browser reads the
--       viewer's own data with their session (comments, user lists). There is
--       NO insert/update/delete policy, so anon and authenticated cannot write
--       directly: creation, rename and delete all go through /api/clips/*,
--       which validates every field and uses the service role (like every other
--       server-side read/write in this repo, e.g. provider_health, episodes).
--       The route never trusts a client-supplied user id.
--     * public.clip_reports: RLS enabled with NO policies at all, so only the
--       service role can read or write it.
--   The unique `code` index is also the collision check used by the generator.
--
-- ADMIN DELETE
--   This repo has no admin concept (no role column, no admin area), so there is
--   no admin-only UI. Deleting a clip as staff is a service-role action, e.g.
--   from the Supabase SQL editor (uncomment to use):
--     -- soft delete (the moderation trail stays):
--     -- update public.clips set deleted_at = now() where code = 'abc2345';
--     -- hard delete:
--     -- delete from public.clips where code = 'abc2345';
--
-- Everything below is idempotent: run it again safely.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- clips
-- ---------------------------------------------------------------------------
create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  anilist_id bigint not null references public.anime(anilist_id) on delete cascade,
  episode_number int not null,
  start_seconds numeric(8,2) not null,
  end_seconds numeric(8,2) not null,
  title text,
  user_id uuid null references auth.users(id) on delete set null,
  owner_token_hash text null,
  source_audio text null,
  views int not null default 0,
  created_at timestamptz default now(),
  deleted_at timestamptz null,
  constraint clips_range_order check (end_seconds > start_seconds),
  constraint clips_range_length check (end_seconds - start_seconds <= 120),
  constraint clips_range_start check (start_seconds >= 0),
  constraint clips_episode_positive check (episode_number > 0),
  constraint clips_views_positive check (views >= 0),
  constraint clips_source_audio check (source_audio is null or source_audio in ('sub', 'dub'))
);

-- 7 characters, lowercase, from the code generator's alphabet
-- (23456789abcdefghjkmnpqrstuvwxyz - no 0/o/1/i/l). Not enforced as a check
-- constraint so the alphabet can change without a migration.
comment on column public.clips.code is
  'Short URL-safe clip code, 7 characters from 23456789abcdefghjkmnpqrstuvwxyz.';
comment on column public.clips.start_seconds is 'Range start in seconds of the normal stream.';
comment on column public.clips.end_seconds is 'Range end in seconds; start + at most 120.';
comment on column public.clips.owner_token_hash is
  'SHA-256/HMAC of the guest owner cookie. The raw token is never stored.';
comment on column public.clips.deleted_at is
  'Soft delete: the clip page 404s, the row remains for reports.';

create unique index if not exists clips_code_key on public.clips (code);
create index if not exists clips_user_created_idx on public.clips (user_id, created_at desc);
create index if not exists clips_anime_episode_idx on public.clips (anilist_id, episode_number);

-- ---------------------------------------------------------------------------
-- clip_reports
-- ---------------------------------------------------------------------------
create table if not exists public.clip_reports (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  reason text not null,
  details text null,
  reporter_hash text null,
  created_at timestamptz not null default now(),
  constraint clip_reports_reason check (reason in ('copyright', 'broken', 'inappropriate', 'spam', 'other'))
);

comment on column public.clip_reports.reporter_hash is
  'Salted hash of the reporter IP. No personal data is stored.';

create index if not exists clip_reports_clip_idx on public.clip_reports (clip_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.clips enable row level security;
alter table public.clip_reports enable row level security;

-- A signed-in user may read their own clips (the rest of the repo reads the
-- viewer's own data with the user-scoped client). Nothing else: writes only
-- happen through the service role behind /api/clips.
drop policy if exists clips_select_own on public.clips;
create policy clips_select_own on public.clips
  for select to authenticated
  using (auth.uid() = user_id);

-- No policies for clip_reports: service role only (created above is enough).

-- ---------------------------------------------------------------------------
-- view counter - one atomic increment per counted view
-- ---------------------------------------------------------------------------
create or replace function public.increment_clip_views(p_code text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  update public.clips
     set views = views + 1
   where code = p_code
     and deleted_at is null
  returning views into next_count;

  return coalesce(next_count, 0);
end;
$$;

-- Only the server (service role) may call it.
revoke all on function public.increment_clip_views(text) from public;
revoke all on function public.increment_clip_views(text) from anon;
revoke all on function public.increment_clip_views(text) from authenticated;
grant execute on function public.increment_clip_views(text) to service_role;
