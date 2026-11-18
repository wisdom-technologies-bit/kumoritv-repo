-- Adult (hentai) playback through the watchhentai service.
--
-- Two tables, nothing existing is altered.
--
-- A row is either curated by hand or written by title discovery when the anime
-- is marked adult and no row exists yet. Either way the row is the proof: an
-- anime with no row keeps resolving through ani and the Anivexa providers
-- exactly as it does now.

create table if not exists public.adult_sources (
  anilist_id      int         not null,
  episode_number  int         not null,
  variant         text        not null check (variant in ('censored', 'uncensored')),
  wh_series_slug  text        not null,
  wh_video_slug   text        not null,
  matched_title   text,
  -- true when title discovery created the row rather than a curator, so
  -- what the machine chose is visible and can be overwritten deliberately
  auto            boolean     not null default false,
  match_score     numeric,
  checked_at      timestamptz not null default now(),
  primary key (anilist_id, episode_number, variant)
);

create index if not exists adult_sources_anilist_idx on public.adult_sources (anilist_id);

-- The upstream MP4 URL is stable for hours and the resolve costs two scrapes,
-- so remember it for fifteen minutes. Only the upstream URL and the headers it
-- needs are stored; the proxy token is signed per request.
create table if not exists public.adult_stream_cache (
  anilist_id     int         not null,
  episode_number int         not null,
  variant        text        not null,
  payload        jsonb       not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  primary key (anilist_id, episode_number, variant)
);

create index if not exists adult_stream_cache_expires_idx on public.adult_stream_cache (expires_at);

alter table public.adult_sources       enable row level security;
alter table public.adult_stream_cache  enable row level security;

-- Server-only tables: the watch route uses the service key, which bypasses RLS.
-- No policy is created, so anon and authenticated callers cannot read them.
