-- Prompt 9: user data on Supabase (notifications, subscriptions, progress extras)
-- Run this in the Supabase SQL editor.

create table if not exists public.notification_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  anilist_id bigint not null,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, anilist_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  anilist_id bigint not null,
  episode integer not null,
  title text,
  cover_url text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, anilist_id, episode)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notification_subscriptions enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "subscriptions own" on public.notification_subscriptions;
create policy "subscriptions own" on public.notification_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications for select using (auth.uid() = user_id);
drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications for delete using (auth.uid() = user_id);

-- when a new aired episode is stored, notify everyone subscribed to that anime
create or replace function public.fanout_episode_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.aired_at < now() - interval '3 days' then
    return new;
  end if;
  insert into public.notifications (user_id, anilist_id, episode, title, cover_url)
  select s.user_id, new.anilist_id, new.episode, coalesce(new.title_english, new.title), new.cover_url
  from public.notification_subscriptions s
  where s.anilist_id = new.anilist_id
  on conflict (user_id, anilist_id, episode) do nothing;
  return new;
end $$;

drop trigger if exists airing_episodes_notify on public.airing_episodes;
create trigger airing_episodes_notify after insert on public.airing_episodes
  for each row execute function public.fanout_episode_notifications();

-- small extras for continue-watching
alter table public.watch_progress add column if not exists snapshot jsonb;
create index if not exists watch_progress_user_updated_idx on public.watch_progress (user_id, updated_at desc);
create index if not exists favourites_user_created_idx on public.favourites (user_id, created_at desc);
