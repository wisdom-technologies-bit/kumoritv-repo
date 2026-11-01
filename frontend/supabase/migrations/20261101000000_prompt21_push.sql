-- =====================================================================
-- Prompt 21: push notifications + unified notification bell
-- Run in the Supabase SQL editor. Idempotent.
-- =====================================================================

-- ---------- helpers ---------------------------------------------------

-- true when a providers jsonb ([] or {} or non-empty) has at least one entry
create or replace function public.has_providers(j jsonb) returns boolean
language sql immutable as $$
  select case jsonb_typeof(j)
    when 'array'  then jsonb_array_length(j) > 0
    when 'object' then j <> '{}'::jsonb
    else false
  end
$$;

-- ---------- push_preferences -----------------------------------------

create table if not exists public.push_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  defaults_applied boolean not null default false,
  new_episodes_all boolean not null default false,
  new_episodes_subscribed boolean not null default false,
  replies boolean not null default false,
  likes boolean not null default false,
  mentions boolean not null default false,
  announcements boolean not null default false,
  digest_last_sent_at timestamptz,
  updated_at timestamptz not null default now(),
  -- "all anime" and "subscribed anime" are mutually exclusive
  constraint push_preferences_episode_mode_chk
    check (not (new_episodes_all and new_episodes_subscribed))
);

alter table public.push_preferences enable row level security;

drop policy if exists "push prefs select own" on public.push_preferences;
create policy "push prefs select own" on public.push_preferences
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "push prefs insert own" on public.push_preferences;
create policy "push prefs insert own" on public.push_preferences
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "push prefs update own" on public.push_preferences;
create policy "push prefs update own" on public.push_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.push_preferences_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  -- the digest cursor belongs to the server, never the browser
  if tg_op = 'UPDATE' and auth.role() = 'authenticated' then
    new.digest_last_sent_at := old.digest_last_sent_at;
  end if;
  return new;
end $$;

drop trigger if exists push_preferences_touch_trg on public.push_preferences;
create trigger push_preferences_touch_trg before update on public.push_preferences
  for each row execute function public.push_preferences_touch();

-- does this user want this kind of push right now?
create or replace function public.push_allowed(p_user uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select pp.enabled and case p_kind
      when 'reply'        then pp.replies
      when 'like'         then pp.likes
      when 'mention'      then pp.mentions
      when 'announcement' then pp.announcements
      when 'episode'      then pp.new_episodes_subscribed
      when 'digest'       then pp.new_episodes_all
      else false end
    from public.push_preferences pp where pp.user_id = p_user
  ), false)
$$;

-- ---------- push_outbox (server only) --------------------------------

create table if not exists public.push_outbox (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('episode','digest','reply','like','mention','announcement')),
  title text not null,
  body text,
  url text,
  image text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index if not exists push_outbox_pending_idx on public.push_outbox (id) where sent_at is null;

alter table public.push_outbox enable row level security;   -- no policies: service role only
revoke all on public.push_outbox from anon, authenticated;

-- safely claim a batch (overlapping cron runs never get the same rows)
create or replace function public.claim_push_outbox(p_limit int default 200)
returns setof public.push_outbox
language sql security definer set search_path = public as $$
  update public.push_outbox o
     set claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select id from public.push_outbox
      where sent_at is null and attempts < 5
        and (claimed_at is null or claimed_at < now() - interval '5 minutes')
      order by id
      limit p_limit
      for update skip locked)
  returning o.*;
$$;
revoke execute on function public.claim_push_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_push_outbox(int) to service_role;

-- ---------- user_notifications (bell: replies, likes, mentions, digests)

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('reply','like','mention','digest')),
  title text not null,
  body text,
  url text,
  image text,
  actor_name text,
  actor_avatar text,
  comment_id uuid,
  count int not null default 1,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create unique index if not exists user_notifications_dedupe_uidx
  on public.user_notifications (user_id, kind, comment_id);
create index if not exists user_notifications_user_idx
  on public.user_notifications (user_id, created_at desc);

alter table public.user_notifications enable row level security;

drop policy if exists "user notifs select own" on public.user_notifications;
create policy "user notifs select own" on public.user_notifications
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "user notifs update own" on public.user_notifications;
create policy "user notifs update own" on public.user_notifications
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "user notifs delete own" on public.user_notifications;
create policy "user notifs delete own" on public.user_notifications
  for delete to authenticated using (auth.uid() = user_id);

-- the browser may only change read_at
revoke update on public.user_notifications from anon, authenticated;
grant update (read_at) on public.user_notifications to authenticated;

-- ---------- announcements (you add rows in the Table Editor) ---------

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  url text,
  image text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  push_sent_at timestamptz
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);

alter table public.announcements enable row level security;
drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to authenticated using (expires_at is null or expires_at > now());

create table if not exists public.announcement_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, announcement_id)
);
alter table public.announcement_reads enable row level security;
drop policy if exists "announcement reads select own" on public.announcement_reads;
create policy "announcement reads select own" on public.announcement_reads
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "announcement reads insert own" on public.announcement_reads;
create policy "announcement reads insert own" on public.announcement_reads
  for insert to authenticated with check (auth.uid() = user_id);

-- ---------- replies ---------------------------------------------------

create or replace function public.notify_comment_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_user uuid; actor_name text; actor_avatar text; snippet text; link text;
begin
  if new.parent_id is null then return new; end if;
  select user_id into parent_user from public.comments where id = new.parent_id;
  if parent_user is null or parent_user = new.user_id then return new; end if;

  select coalesce(p.display_name, p.username, 'Someone'), p.avatar_url
    into actor_name, actor_avatar from public.profiles p where p.id = new.user_id;
  actor_name := coalesce(actor_name, 'Someone');

  snippet := case when new.is_spoiler then 'Spoiler' else left(new.body, 120) end;
  link := case when new.episode_number is null
               then '/media/' || new.anilist_id
               else '/watch/' || new.anilist_id || '?ep=' || new.episode_number end;

  insert into public.user_notifications
    (user_id, kind, title, body, url, image, actor_name, actor_avatar, comment_id)
  values
    (parent_user, 'reply', actor_name || ' replied to your comment', snippet, link,
     actor_avatar, actor_name, actor_avatar, new.id)
  on conflict (user_id, kind, comment_id) do nothing;

  if public.push_allowed(parent_user, 'reply') then
    insert into public.push_outbox (user_id, type, title, body, url, image, dedupe_key)
    values (parent_user, 'reply', actor_name || ' replied to your comment', snippet, link,
            actor_avatar, 'reply:' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists comments_notify_reply_trg on public.comments;
create trigger comments_notify_reply_trg after insert on public.comments
  for each row execute function public.notify_comment_reply();

-- ---------- mentions ---------------------------------------------------

create or replace function public.notify_comment_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tokens text[]; parent_user uuid; actor_name text; actor_avatar text;
  snippet text; link text; r record;
begin
  if new.body !~ '@[A-Za-z0-9_.-]{3,30}' then return new; end if;

  select array(
    with raw as (select (regexp_matches(new.body, '@([A-Za-z0-9_.-]{3,30})', 'g'))[1] as t)
    select t from raw
    union
    select rtrim(t, '._-') from raw
  ) into tokens;

  if new.parent_id is not null then
    select user_id into parent_user from public.comments where id = new.parent_id;
  end if;

  select coalesce(p.display_name, p.username, 'Someone'), p.avatar_url
    into actor_name, actor_avatar from public.profiles p where p.id = new.user_id;
  actor_name := coalesce(actor_name, 'Someone');

  snippet := case when new.is_spoiler then 'Spoiler' else left(new.body, 120) end;
  link := case when new.episode_number is null
               then '/media/' || new.anilist_id
               else '/watch/' || new.anilist_id || '?ep=' || new.episode_number end;

  for r in
    select p.id from public.profiles p
     where p.username = any(tokens)
       and p.id <> new.user_id
       and p.id is distinct from parent_user   -- the parent author already gets the reply notification
     limit 10                                  -- anti-spam: at most 10 people per comment
  loop
    insert into public.user_notifications
      (user_id, kind, title, body, url, image, actor_name, actor_avatar, comment_id)
    values
      (r.id, 'mention', actor_name || ' mentioned you', snippet, link,
       actor_avatar, actor_name, actor_avatar, new.id)
    on conflict (user_id, kind, comment_id) do nothing;

    if public.push_allowed(r.id, 'mention') then
      insert into public.push_outbox (user_id, type, title, body, url, image, dedupe_key)
      values (r.id, 'mention', actor_name || ' mentioned you', snippet, link,
              actor_avatar, 'mention:' || new.id || ':' || r.id)
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists comments_notify_mentions_trg on public.comments;
create trigger comments_notify_mentions_trg after insert on public.comments
  for each row execute function public.notify_comment_mentions();

-- ---------- likes ------------------------------------------------------

create or replace function public.notify_comment_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c record; n int; ttl text; snippet text; link text;
begin
  if new.value <> 1 then return new; end if;
  if tg_op = 'UPDATE' and old.value = 1 then return new; end if;

  select id, user_id, anilist_id, episode_number, body, is_spoiler
    into c from public.comments where id = new.comment_id and deleted_at is null;
  if not found or c.user_id = new.user_id then return new; end if;

  select count(*) into n from public.comment_reactions
   where comment_id = new.comment_id and value = 1;

  ttl := case when n = 1 then 'Your comment got 1 like' else 'Your comment got ' || n || ' likes' end;
  snippet := case when c.is_spoiler then 'Spoiler' else left(c.body, 120) end;
  link := case when c.episode_number is null
               then '/media/' || c.anilist_id
               else '/watch/' || c.anilist_id || '?ep=' || c.episode_number end;

  -- one bell row per comment; later likes update it in place
  insert into public.user_notifications (user_id, kind, title, body, url, comment_id, count)
  values (c.user_id, 'like', ttl, snippet, link, c.id, n)
  on conflict (user_id, kind, comment_id) do update
    set title = excluded.title,
        body = excluded.body,
        count = excluded.count,
        created_at = case when excluded.count > public.user_notifications.count
                          then now() else public.user_notifications.created_at end,
        read_at = case when excluded.count > public.user_notifications.count
                       then null else public.user_notifications.read_at end;

  -- at most one push per comment per hour
  if public.push_allowed(c.user_id, 'like') then
    insert into public.push_outbox (user_id, type, title, body, url, dedupe_key)
    values (c.user_id, 'like', ttl, snippet, link,
            'like:' || c.id || ':' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24'))
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists comment_reactions_notify_trg on public.comment_reactions;
create trigger comment_reactions_notify_trg after insert or update of value on public.comment_reactions
  for each row execute function public.notify_comment_like();

-- ---------- new playable episodes -------------------------------------

alter table public.episodes add column if not exists playable_at timestamptz;
create index if not exists episodes_playable_idx on public.episodes (playable_at) where playable_at is not null;

-- stamp the moment an episode first has a sub or dub provider
create or replace function public.set_episode_playable_at() returns trigger
language plpgsql as $$
begin
  if (public.has_providers(new.sub_providers) or public.has_providers(new.dub_providers))
     and (tg_op = 'INSERT'
          or not (public.has_providers(old.sub_providers) or public.has_providers(old.dub_providers)))
  then
    new.playable_at := now();
  end if;
  return new;
end $$;

drop trigger if exists episodes_playable_at_trg on public.episodes;
create trigger episodes_playable_at_trg before insert or update of sub_providers, dub_providers on public.episodes
  for each row execute function public.set_episode_playable_at();

-- push to subscribers the moment an episode becomes watchable
-- (only episodes that aired in the last 2 days, so importing the back catalogue never floods anyone)
create or replace function public.notify_episode_playable() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.air_date is null or new.air_date < current_date - 2 then return new; end if;
  if not (public.has_providers(new.sub_providers) or public.has_providers(new.dub_providers)) then return new; end if;
  if tg_op = 'UPDATE' and (public.has_providers(old.sub_providers) or public.has_providers(old.dub_providers)) then return new; end if;

  select coalesce(title_english, title) as t, cover_url, is_adult
    into a from public.anime where anilist_id = new.anilist_id;
  if not found then return new; end if;

  insert into public.push_outbox (user_id, type, title, body, url, image, dedupe_key)
  select s.user_id, 'episode', a.t,
         'Episode ' || new.episode_number || ' is now available to watch',
         '/watch/' || new.anilist_id || '?ep=' || new.episode_number,
         a.cover_url,
         'episode:' || new.anilist_id || ':' || new.episode_number || ':' || s.user_id
    from public.notification_subscriptions s
    join public.push_preferences pp on pp.user_id = s.user_id and pp.enabled and pp.new_episodes_subscribed
    left join public.profiles pr on pr.id = s.user_id
   where s.anilist_id = new.anilist_id
     and (not a.is_adult or coalesce(pr.show_adult, false))
  on conflict (dedupe_key) do nothing;
  return new;
end $$;

drop trigger if exists episodes_notify_playable_trg on public.episodes;
create trigger episodes_notify_playable_trg after insert or update of sub_providers, dub_providers on public.episodes
  for each row execute function public.notify_episode_playable();

-- ---------- housekeeping (optional: call now and then) -----------------

create or replace function public.prune_push_data() returns void
language sql security definer set search_path = public as $$
  delete from public.push_outbox where sent_at is not null and sent_at < now() - interval '14 days';
  delete from public.push_outbox where sent_at is null and attempts >= 5 and created_at < now() - interval '7 days';
  delete from public.user_notifications where created_at < now() - interval '60 days';
$$;
revoke execute on function public.prune_push_data() from public, anon, authenticated;
grant execute on function public.prune_push_data() to service_role;
