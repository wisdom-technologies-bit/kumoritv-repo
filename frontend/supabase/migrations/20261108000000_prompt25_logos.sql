-- =====================================================================
-- Prompt 25: TMDB title logos
-- Run in the Supabase SQL editor. Idempotent.
--
-- Adds the stylised title-logo columns to `public.anime` and the partial
-- index the `/api/cron/logos` job walks. The site keeps working with text
-- titles until this has been run.
-- =====================================================================

alter table public.anime
  add column if not exists logo_path text,
  add column if not exists logo_aspect_ratio numeric,
  add column if not exists logo_width integer,
  add column if not exists logo_status text,
  add column if not exists logo_checked_at timestamptz;

alter table public.anime drop constraint if exists anime_logo_status_check;
alter table public.anime
  add constraint anime_logo_status_check
  check (logo_status is null or logo_status in ('found','none','error'));

create index if not exists anime_logo_pending_idx
  on public.anime (logo_checked_at nulls first, anilist_id)
  where logo_path is null;

-- No new RLS policies: the existing public read on `anime` already covers new
-- columns, and the cron writes with the service-role admin client.
