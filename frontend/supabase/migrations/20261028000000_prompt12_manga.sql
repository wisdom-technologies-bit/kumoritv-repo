-- Prompt 12: manga

-- cache of which MangaDex entry matches an AniList manga (server-only table)
create table if not exists public.manga_sources (
  anilist_id bigint primary key,
  mangadex_id uuid,
  title text,
  not_found boolean not null default false,
  checked_at timestamptz not null default now()
);
alter table public.manga_sources enable row level security;  -- no policies: only the server key can read/write

-- chapters a user has read
create table if not exists public.chapters_read (
  user_id uuid not null references auth.users(id) on delete cascade,
  anilist_id bigint not null,
  chapter_number numeric not null,
  chapter_id text,
  last_page int,
  snapshot jsonb,
  read_at timestamptz not null default now(),
  primary key (user_id, anilist_id, chapter_number)
);
alter table public.chapters_read enable row level security;
drop policy if exists "chapters_read own" on public.chapters_read;
create policy "chapters_read own" on public.chapters_read
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists chapters_read_user_idx on public.chapters_read (user_id, read_at desc);
