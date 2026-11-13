-- =====================================================================
-- Prompt 38B - community Phase 1, file 2 of 2: the community schema
--
-- RUN ORDER: 1) docs/sql/profiles-rls.sql   2) this file
-- (Run docs/sql/clips.sql first only on a fresh database - community_posts
--  points at public.clips, which has existed in production since Prompt 35.)
--
-- WHAT THIS CHANGES
--   0. public.staff_roles  - the ONLY place a role lives. No browser role can
--      read or write it; grants are SQL only (see the snippet at the bottom).
--      public.is_staff() / public.is_admin() read it as security definer.
--   1. public.community_posts + indexes (text posts; clip_id/link_* columns
--      exist but no Phase 1 UI writes them).
--   2. public.comments gains target_type / post_id / announcement_id, a
--      400-character cap for community comments and three indexes.
--   3. public.comments_guard() is REPLACED. Every original behaviour is kept:
--      10 s site-wide rate limit, parent must be a live top-level comment of
--      the same target, and on update only is_spoiler / deleted_at may move.
--      See the note further down about comparing with production.
--   4. public.comment_link(comments) - one place that knows every comment URL.
--   5. public.comment_feed is REPLACED: same columns in the same order, new
--      columns at the END, and it now hides comments whose post is not
--      published/deleted or whose announcement has expired. This view runs as
--      its owner, so those WHERE clauses are the whole privacy rule.
--   6. reactions + community_react(), reports, blocks, moderation log.
--   7. RLS and grants for every new table, plus the comments insert policy
--      (target validation + no anonymous sessions) and the anon announcement
--      read policy.
--   8. community_feed_page() - posts + announcements arms, keyset cursor.
--   9. community_new_posts() - cheap "what is new" helper.
--  10. community_posts_guard() - durable 1/30 s, 20/h, duplicate-body limits.
--  11. notify_comment_reply / _mentions / _like now build their link with
--      public.comment_link(), so a post comment does not become '/media/'.
--
-- IDEMPOTENT: every statement is create-if-not-exists / or-replace /
-- drop-policy-if-exists. Safe to run twice.
--
-- HOW TO VERIFY (after running):
--   select relrowsecurity from pg_class where oid='public.staff_roles'::regclass;      -- t
--   select count(*) from pg_policies where tablename='staff_roles';                     -- 0
--   select has_table_privilege('anon','public.staff_roles','select');                   -- f
--   select proname, prosecdef from pg_proc where proname in ('is_staff','is_admin');    -- t, t
--   select count(*) from pg_proc where proname='community_feed_page';                   -- 1
--   select polname from pg_policies where tablename='announcements' order by 1;
--
-- COMPARE THE LIVE GUARD BEFORE RUNNING (production may differ from the repo):
--   select pg_get_functiondef('public.comments_guard'::regproc);
--   The version in this file is a superset of 20261027000100_prompt10_comments.sql
--   (10 s limit, parent validation, frozen columns) plus the target branches.
--   If the live definition has anything else in it, stop and port that change
--   into this file first - this file replaces the function wholesale.
--
-- HOW TO GRANT THE FIRST ADMIN (SQL editor only, never from the app):
--   insert into public.staff_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'OWNER_EMAIL_HERE'
--   on conflict (user_id) do update set role = excluded.role;
--
-- ROLLBACK: docs/sql/community-rollback.sql
-- =====================================================================

-- clip_id keeps a real foreign key, so fail early with a clear message instead
-- of a cryptic "relation public.clips does not exist".
do $$
begin
  if to_regclass('public.clips') is null then
    raise exception 'public.clips is missing. Apply docs/sql/clips.sql first, then re-run this file.';
  end if;
end $$;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. staff roles - SQL only, invisible to every browser role
-- ---------------------------------------------------------------------
create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('moderator','admin')),
  created_at timestamptz not null default now()
);

alter table public.staff_roles enable row level security;

-- Belt and braces: no policy at all (so RLS denies everything) AND no table
-- privilege (so even a policy added by mistake later cannot be used).
revoke all on public.staff_roles from anon, authenticated;
revoke all on public.staff_roles from public;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_roles s
     where s.user_id = auth.uid() and s.role in ('moderator','admin')
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_roles s
     where s.user_id = auth.uid() and s.role = 'admin'
  );
$$;

revoke execute on function public.is_staff() from public;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. community_posts
-- ---------------------------------------------------------------------
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  is_spoiler boolean not null default false,
  clip_id uuid references public.clips(id) on delete set null,
  link_url text,
  link_title text,
  link_image text,
  pinned boolean not null default false,
  status text not null default 'published'
    check (status in ('published','hidden','removed')),
  removed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint community_posts_body_len check (char_length(body) between 1 and 1000),
  constraint community_posts_attachment_chk check (clip_id is null or link_url is null),
  constraint community_posts_link_scheme check (
    link_url is null or link_url ~* '^https?://[a-z0-9.-]+'
  )
);

comment on column public.community_posts.clip_id is
  'Pointer to a clips row. A clip is a time range, never a file.';
comment on column public.community_posts.link_image is
  'Only our own CDN URL or a resolved clip thumbnail. Never a user-supplied remote image.';
comment on column public.community_posts.status is
  'published = visible; hidden = held back by staff; removed = taken down, row kept for the report trail.';

create index if not exists community_posts_feed_idx
  on public.community_posts (created_at desc, id)
  where deleted_at is null and status = 'published';
create index if not exists community_posts_author_idx
  on public.community_posts (author_id, created_at desc)
  where deleted_at is null;
create index if not exists community_posts_clip_idx
  on public.community_posts (clip_id)
  where clip_id is not null;

-- ---------------------------------------------------------------------
-- 2. comments: extend for posts and announcements
-- ---------------------------------------------------------------------
alter table public.comments alter column anilist_id drop not null;

alter table public.comments
  add column if not exists target_type text not null default 'anime',
  add column if not exists post_id uuid
    references public.community_posts(id) on delete cascade,
  add column if not exists announcement_id uuid
    references public.announcements(id) on delete cascade;

alter table public.comments drop constraint if exists comments_target_type_chk;
alter table public.comments
  add constraint comments_target_type_chk
  check (target_type in ('anime','post','announcement'));

-- Exactly one target per row. Two nullable columns (not one shared uuid) so
-- both foreign keys stay real: one column cannot reference two tables.
alter table public.comments drop constraint if exists comments_target_chk;
alter table public.comments
  add constraint comments_target_chk check (
    case target_type
      when 'anime'        then anilist_id is not null and post_id is null and announcement_id is null
      when 'post'         then anilist_id is null and post_id is not null and announcement_id is null
      when 'announcement' then anilist_id is null and post_id is null and announcement_id is not null
      else false
    end
  );

-- The 400-character UI limit was never enforced by the database (the core
-- column allows 2000). Anime comments keep 2000 for compatibility; community
-- comments get the real 400 - the browser is no longer the only guard.
alter table public.comments drop constraint if exists comments_body_len_chk;
alter table public.comments
  add constraint comments_body_len_chk
  check (target_type = 'anime' or char_length(body) <= 400);

create index if not exists comments_community_feed_idx
  on public.comments (created_at desc, id)
  where deleted_at is null and parent_id is null and target_type = 'anime';
create index if not exists comments_post_idx
  on public.comments (post_id, created_at desc)
  where post_id is not null and deleted_at is null;
create index if not exists comments_announcement_idx
  on public.comments (announcement_id, created_at desc)
  where announcement_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------
-- 3. the guard, extended (rate limit stays site-wide at 10 s)
-- ---------------------------------------------------------------------
create or replace function public.comments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- ORIGINAL BEHAVIOUR 1: one comment per user per 10 seconds, site-wide.
    if exists (
      select 1 from public.comments c
       where c.user_id = new.user_id and c.created_at > now() - interval '10 seconds'
    ) then
      raise exception 'You are commenting too fast. Please wait a few seconds.';
    end if;

    -- ORIGINAL BEHAVIOUR 2: a reply must point at a live top-level comment of
    -- the same thing (anime -> same anilist_id; post/announcement -> same id).
    if new.parent_id is not null then
      if new.target_type = 'anime' then
        if not exists (
          select 1 from public.comments p
           where p.id = new.parent_id and p.parent_id is null
             and p.anilist_id = new.anilist_id and p.deleted_at is null
        ) then
          raise exception 'Invalid reply target.';
        end if;
      else
        if not exists (
          select 1 from public.comments p
           where p.id = new.parent_id and p.parent_id is null
             and p.target_type = new.target_type
             and p.post_id is not distinct from new.post_id
             and p.announcement_id is not distinct from new.announcement_id
             and p.deleted_at is null
        ) then
          raise exception 'Invalid reply target.';
        end if;
      end if;
    end if;
  else
    -- ORIGINAL BEHAVIOUR 3: only is_spoiler / deleted_at may move; every other
    -- column is frozen, and updated_at is stamped.
    new.user_id := old.user_id;
    new.anilist_id := old.anilist_id;
    new.episode_number := old.episode_number;
    new.parent_id := old.parent_id;
    new.body := old.body;
    new.created_at := old.created_at;
    new.target_type := old.target_type;
    new.post_id := old.post_id;
    new.announcement_id := old.announcement_id;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists comments_guard_trg on public.comments;
create trigger comments_guard_trg before insert or update on public.comments
  for each row execute function public.comments_guard();

-- one place that knows every comment URL, so notifications stop guessing
create or replace function public.comment_link(c public.comments) returns text
language sql stable set search_path = public as $$
  select case c.target_type
    when 'post' then
      '/community/post/' || c.post_id::text || '#comment-' || c.id::text
    when 'announcement' then
      '/community/announcements/' || c.announcement_id::text || '#comment-' || c.id::text
    else
      case when c.episode_number is null
        then '/media/' || c.anilist_id::text || '#comment-' || c.id::text
        else '/watch/' || c.anilist_id::text || '?ep=' || c.episode_number::text
             || '#comment-' || c.id::text
      end
  end
$$;

-- ---------------------------------------------------------------------
-- 4. comment_feed: same columns, same order, new ones at the END.
--    Now also excludes comments whose post is hidden/removed/deleted and
--    comments on an expired announcement (this view runs as its owner, so a
--    WHERE clause here is the only privacy rule there is).
-- ---------------------------------------------------------------------
create or replace view public.comment_feed as
select c.id, c.anilist_id, c.episode_number, c.parent_id, c.user_id, c.body,
       c.is_spoiler, c.created_at, p.username, p.display_name, p.avatar_url,
       coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int as likes,
       coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int as dislikes,
       c.target_type, c.post_id, c.announcement_id
from public.comments c
left join public.public_profiles p on p.id = c.user_id
left join public.comment_reactions r on r.comment_id = c.id
left join public.community_posts cp on cp.id = c.post_id
left join public.announcements an on an.id = c.announcement_id
where c.deleted_at is null
  and (c.target_type <> 'post'
       or (cp.id is not null and cp.deleted_at is null and cp.status = 'published'))
  and (c.target_type <> 'announcement'
       or (an.id is not null and (an.expires_at is null or an.expires_at > now())))
group by c.id, p.username, p.display_name, p.avatar_url;
grant select on public.comment_feed to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. reactions on posts and announcements
-- ---------------------------------------------------------------------
create table if not exists public.community_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('post','announcement')),
  post_id uuid references public.community_posts(id) on delete cascade,
  announcement_id uuid references public.announcements(id) on delete cascade,
  value smallint not null check (value in (1,-1)),
  created_at timestamptz not null default now(),
  constraint community_reactions_target_chk check (
    (target_kind = 'post' and post_id is not null and announcement_id is null) or
    (target_kind = 'announcement' and post_id is null and announcement_id is not null)
  )
);

create unique index if not exists community_reactions_post_uidx
  on public.community_reactions (post_id, user_id) where post_id is not null;
create unique index if not exists community_reactions_ann_uidx
  on public.community_reactions (announcement_id, user_id) where announcement_id is not null;

-- One way in: insert, switch, or clear. Written as a function so the API and
-- the UI cannot disagree, and so the counts always come back together.
create or replace function public.community_react(
  p_kind text, p_id uuid, p_value smallint
) returns table (likes int, dislikes int, mine smallint)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in to react.'; end if;
  if p_value is not null and p_value not in (1,-1) then
    raise exception 'Invalid reaction.';
  end if;

  if p_kind = 'post' then
    if not exists (
      select 1 from public.community_posts p
       where p.id = p_id and p.deleted_at is null and p.status = 'published'
    ) then raise exception 'Post not found.'; end if;

    if p_value is null then
      delete from public.community_reactions r
       where r.user_id = uid and r.post_id = p_id;
    else
      insert into public.community_reactions as r (user_id, target_kind, post_id, value)
      values (uid, 'post', p_id, p_value)
      on conflict (post_id, user_id) where post_id is not null
        do update set value = excluded.value;
    end if;

    return query
      select coalesce(count(*) filter (where r.value = 1), 0)::int,
             coalesce(count(*) filter (where r.value = -1), 0)::int,
             (select r2.value from public.community_reactions r2
               where r2.post_id = p_id and r2.user_id = uid)
        from public.community_reactions r where r.post_id = p_id;
  elsif p_kind = 'announcement' then
    if not exists (
      select 1 from public.announcements a
       where a.id = p_id and (a.expires_at is null or a.expires_at > now())
    ) then raise exception 'Announcement not found.'; end if;

    if p_value is null then
      delete from public.community_reactions r
       where r.user_id = uid and r.announcement_id = p_id;
    else
      insert into public.community_reactions as r (user_id, target_kind, announcement_id, value)
      values (uid, 'announcement', p_id, p_value)
      on conflict (announcement_id, user_id) where announcement_id is not null
        do update set value = excluded.value;
    end if;

    return query
      select coalesce(count(*) filter (where r.value = 1), 0)::int,
             coalesce(count(*) filter (where r.value = -1), 0)::int,
             (select r2.value from public.community_reactions r2
               where r2.announcement_id = p_id and r2.user_id = uid)
        from public.community_reactions r where r.announcement_id = p_id;
  else
    raise exception 'Invalid target.';
  end if;
end $$;

revoke execute on function public.community_react(text, uuid, smallint) from public;
grant execute on function public.community_react(text, uuid, smallint) to authenticated;

-- ---------------------------------------------------------------------
-- 6. reports
-- ---------------------------------------------------------------------
create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  reporter_hash text,
  target_kind text not null check (target_kind in ('post','comment','announcement')),
  target_id uuid not null,
  reason text not null
    check (reason in ('spam','harassment','spoiler','inappropriate','copyright','other')),
  details text,
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  constraint community_reports_details_len
    check (details is null or char_length(details) <= 500)
);

create unique index if not exists community_reports_once_idx
  on public.community_reports (target_kind, target_id, reporter_id)
  where reporter_id is not null;
create index if not exists community_reports_open_idx
  on public.community_reports (created_at desc)
  where status = 'open';

-- ---------------------------------------------------------------------
-- 7. blocks (Phase 6 UI; the table ships now so the feed can honour it)
-- ---------------------------------------------------------------------
create table if not exists public.community_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint community_blocks_not_self check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------
-- 8. moderation trail
-- ---------------------------------------------------------------------
create table if not exists public.community_moderation_log (
  id bigserial primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('hide','unhide','remove','restore','role_change')),
  target_kind text not null check (target_kind in ('post','comment','announcement','profile')),
  target_id uuid not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists community_moderation_log_created_idx
  on public.community_moderation_log (created_at desc);

-- ---------------------------------------------------------------------
-- 9. RLS and grants
-- ---------------------------------------------------------------------
alter table public.community_posts enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_blocks enable row level security;
alter table public.community_moderation_log enable row level security;

-- posts: public read of live, published rows; the author sees their own
-- hidden/removed rows; staff see everything. No insert policy: the ONLY way
-- to create a post is POST /api/community/posts, which validates length,
-- profanity and author on the server (amendment 4). A direct PostgREST insert
-- - from a browser, a guest or a signed-in user - is refused by RLS.
drop policy if exists "community posts read" on public.community_posts;
create policy "community posts read" on public.community_posts
  for select to anon, authenticated
  using (
    (deleted_at is null and status = 'published')
    or auth.uid() = author_id
    or public.is_staff()
  );

drop policy if exists "community posts insert own" on public.community_posts;

drop policy if exists "community posts update own" on public.community_posts;
create policy "community posts update own" on public.community_posts
  for update to authenticated
  using (auth.uid() = author_id or public.is_staff())
  with check (auth.uid() = author_id or public.is_staff());

-- comments: the old policy did not know about the new target types, and it
-- let an anonymous Supabase session (the "continue as guest" path) comment.
-- Both are closed here; the guard trigger validates the parent.
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and (
      target_type = 'anime'
      or (target_type = 'post' and exists (
            select 1 from public.community_posts p
             where p.id = post_id and p.deleted_at is null and p.status = 'published'))
      or (target_type = 'announcement' and exists (
            select 1 from public.announcements a
             where a.id = announcement_id
               and (a.expires_at is null or a.expires_at > now())))
    )
  );

-- reactions: own rows only (same shape as comment_reactions)
drop policy if exists "community reactions read own" on public.community_reactions;
create policy "community reactions read own" on public.community_reactions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "community reactions write own" on public.community_reactions;
create policy "community reactions write own" on public.community_reactions
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- reports: a signed-in user may file one and read back their own; staff read
-- all. Anonymous reports go through the API route with a salted hash and the
-- service role.
drop policy if exists "community reports insert own" on public.community_reports;
create policy "community reports insert own" on public.community_reports
  for insert to authenticated with check (auth.uid() = reporter_id);
drop policy if exists "community reports read own" on public.community_reports;
create policy "community reports read own" on public.community_reports
  for select to authenticated using (auth.uid() = reporter_id or public.is_staff());

-- blocks: entirely private to the blocker
drop policy if exists "community blocks own" on public.community_blocks;
create policy "community blocks own" on public.community_blocks
  for all to authenticated
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- moderation log: staff read, nobody writes from a browser
drop policy if exists "community moderation log read" on public.community_moderation_log;
create policy "community moderation log read" on public.community_moderation_log
  for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.community_moderation_log from anon, authenticated;

-- announcements: visitors see them (the bell only ever needed signed-in
-- readers, the public feed needs everyone), admins manage them.
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

-- ---------------------------------------------------------------------
-- 10. the feed: posts + announcements arms (Phase 1), keyset cursor.
--     security definer, so every rule is written out here - this function
--     does not read the tables through RLS.
-- ---------------------------------------------------------------------
create or replace function public.community_feed_page(
  p_limit int default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_key text default null,
  p_kind text default 'all',
  p_show_adult boolean default false,
  p_author uuid default null,
  p_anilist_id bigint default null,
  p_hide_blocked boolean default true
) returns table (
  feed_key text, kind text, created_at timestamptz,
  author_id uuid, author_username text, author_display_name text, author_avatar text,
  body text, is_spoiler boolean, title text, image_url text, link_url text,
  clip_code text, clip_start numeric, clip_end numeric,
  anime_id bigint, anime_title text, anime_cover text, episode_number int,
  target_url text, reply_count int, likes int, dislikes int
)
language sql stable security definer set search_path = public as $$
with lim as (select least(greatest(coalesce(p_limit, 20), 1), 50) as n),
src as (
  -- ---------------------------- posts ---------------------------------
  (
    select
      'post:' || p.id::text as feed_key,
      'post'::text as kind,
      p.created_at,
      p.author_id,
      pr.username::text as author_username,
      pr.display_name::text as author_display_name,
      pr.avatar_url::text as author_avatar,
      case when p.is_spoiler then null else p.body end as body,
      p.is_spoiler,
      null::text as title,
      null::text as image_url,
      p.link_url,
      cl.code::text as clip_code,
      cl.start_seconds as clip_start,
      cl.end_seconds as clip_end,
      cl.anilist_id as anime_id,
      coalesce(a.title_english, a.title)::text as anime_title,
      a.cover_url::text as anime_cover,
      cl.episode_number,
      '/community/post/' || p.id::text as target_url,
      (select count(*)::int from public.comments rc
        where rc.post_id = p.id and rc.parent_id is null and rc.deleted_at is null) as reply_count
    from public.community_posts p
    left join public.public_profiles pr on pr.id = p.author_id
    left join public.clips cl on cl.id = p.clip_id and cl.deleted_at is null
    left join public.anime a on a.anilist_id = cl.anilist_id
    where p.deleted_at is null
      and p.status = 'published'
      and p_kind in ('all','post')
      and (p_author is null or p.author_id = p_author)
      and (p_anilist_id is null or cl.anilist_id = p_anilist_id)
      and (not p_hide_blocked or not exists (
            select 1 from public.community_blocks b
             where b.blocker_id = auth.uid() and b.blocked_id = p.author_id))
      and (p_cursor_created_at is null
           or p.created_at < p_cursor_created_at
           or (p.created_at = p_cursor_created_at
               and 'post:' || p.id::text < coalesce(p_cursor_key, '')))
    order by p.created_at desc, feed_key desc
    limit (select n from lim)
  )
  union all
  -- ------------------------- announcements ----------------------------
  (
    select
      'announcement:' || an.id::text,
      'announcement'::text,
      an.created_at,
      null::uuid,
      null::text,
      'KumoriTV'::text,
      null::text,
      an.body,
      false,
      an.title,
      an.image,
      an.url,
      null::text, null::numeric, null::numeric,
      null::bigint, null::text, null::text, null::int,
      '/community/announcements/' || an.id::text,
      (select count(*)::int from public.comments rc
        where rc.announcement_id = an.id and rc.parent_id is null and rc.deleted_at is null)
    from public.announcements an
    where (an.expires_at is null or an.expires_at > now())
      and p_kind in ('all','announcement')
      and p_author is null
      and p_anilist_id is null
      and (p_cursor_created_at is null
           or an.created_at < p_cursor_created_at
           or (an.created_at = p_cursor_created_at
               and 'announcement:' || an.id::text < coalesce(p_cursor_key, '')))
    order by an.created_at desc, 1 desc
    limit (select n from lim)
  )
)
select s.*,
       -- Only post rows have a post id. Casting the substring for a comment
       -- or announcement row would raise invalid input syntax for uuid, so
       -- the CASE is what makes this safe for every row type.
       coalesce((select sum(case when r.value = 1 then 1 else 0 end)::int
                   from public.community_reactions r
                  where r.post_id = case when s.kind = 'post'
                                         then substring(s.feed_key from 6)::uuid end), 0) as likes,
       coalesce((select sum(case when r.value = -1 then 1 else 0 end)::int
                   from public.community_reactions r
                  where r.post_id = case when s.kind = 'post'
                                         then substring(s.feed_key from 6)::uuid end), 0) as dislikes
from src s
order by s.created_at desc, s.feed_key desc
limit (select n from lim);
$$;

revoke execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean) from public;
grant execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 11. "new since" - cheap helper for a later phase, already safe to call
-- ---------------------------------------------------------------------
create or replace function public.community_new_posts(
  p_after timestamptz default null,
  p_limit int default 5,
  p_exclude_author uuid default null
) returns table (
  id uuid, created_at timestamptz,
  author_name text, author_avatar text,
  snippet text, has_clip boolean, clip_code text,
  anime_id bigint, episode_number int,
  total bigint
)
language sql stable security definer set search_path = public as $$
  with rows as (
    select p.id, p.created_at, p.author_id, p.body, p.is_spoiler, p.clip_id,
           cl.code as clip_code, cl.anilist_id, cl.episode_number
      from public.community_posts p
      left join public.clips cl on cl.id = p.clip_id and cl.deleted_at is null
     where p.deleted_at is null
       and p.status = 'published'
       and (p_after is null or p.created_at > p_after)
       and (p_exclude_author is null or p.author_id <> p_exclude_author)
     order by p.created_at desc
     limit least(greatest(coalesce(p_limit, 5), 1), 20)
  )
  select r.id, r.created_at,
         coalesce(pr.display_name, pr.username, 'Someone')::text,
         pr.avatar_url::text,
         case when r.is_spoiler then 'Spoiler post' else left(r.body, 120) end,
         (r.clip_id is not null),
         r.clip_code::text,
         r.anilist_id,
         r.episode_number,
         (select count(*) from public.community_posts p2
           where p2.deleted_at is null and p2.status = 'published'
             and (p_after is null or p2.created_at > p_after)
             and (p_exclude_author is null or p2.author_id <> p_exclude_author))
    from rows r
    left join public.public_profiles pr on pr.id = r.author_id
   order by r.created_at desc;
$$;

revoke execute on function public.community_new_posts(timestamptz,int,uuid) from public;
grant execute on function public.community_new_posts(timestamptz,int,uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 12. post guard: durable rate limits, duplicate body, frozen edits
-- ---------------------------------------------------------------------
create or replace function public.community_posts_guard() returns trigger
language plpgsql as $$
declare
  normalised text;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.community_posts p
                where p.author_id = new.author_id
                  and p.created_at > now() - interval '30 seconds') then
      raise exception 'You are posting too fast. Please wait a moment.';
    end if;
    if (select count(*) from public.community_posts p
         where p.author_id = new.author_id
           and p.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'You have reached the posting limit for this hour.';
    end if;

    normalised := regexp_replace(lower(btrim(new.body)), '\s+', ' ', 'g');
    if exists (select 1 from public.community_posts p
                where p.author_id = new.author_id
                  and regexp_replace(lower(btrim(p.body)), '\s+', ' ', 'g') = normalised
                  and p.created_at > now() - interval '10 minutes') then
      raise exception 'You just posted that.';
    end if;

    new.body := btrim(new.body);
    if char_length(new.body) = 0 then
      raise exception 'Write something first.';
    end if;
  else
    -- Only these may move from a browser; status/pinned are staff-only and
    -- are enforced by the RLS update policy plus this freeze.
    new.author_id := old.author_id;
    new.body := old.body;
    new.clip_id := old.clip_id;
    new.link_url := old.link_url;
    new.link_title := old.link_title;
    new.link_image := old.link_image;
    new.created_at := old.created_at;
    if not public.is_staff() then
      new.status := old.status;
      new.pinned := old.pinned;
      new.removed_reason := old.removed_reason;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists community_posts_guard_trg on public.community_posts;
create trigger community_posts_guard_trg before insert or update on public.community_posts
  for each row execute function public.community_posts_guard();

-- ---------------------------------------------------------------------
-- 13. notifications: the link now comes from public.comment_link()
--     Everything else in these three functions is unchanged.
-- ---------------------------------------------------------------------
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
  link := public.comment_link(new);

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
  link := public.comment_link(new);

  for r in
    select p.id from public.profiles p
     where p.username = any(tokens)
       and p.id <> new.user_id
       and p.id is distinct from parent_user
     limit 10
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

create or replace function public.notify_comment_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.comments; n int; ttl text; snippet text; link text;
begin
  if new.value <> 1 then return new; end if;
  if tg_op = 'UPDATE' and old.value = 1 then return new; end if;

  select * into c from public.comments where id = new.comment_id and deleted_at is null;
  if not found or c.user_id = new.user_id then return new; end if;

  select count(*) into n from public.comment_reactions
   where comment_id = new.comment_id and value = 1;

  ttl := case when n = 1 then 'Your comment got 1 like' else 'Your comment got ' || n || ' likes' end;
  snippet := case when c.is_spoiler then 'Spoiler' else left(c.body, 120) end;
  link := public.comment_link(c);

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

  if public.push_allowed(c.user_id, 'like') then
    insert into public.push_outbox (user_id, type, title, body, url, dedupe_key)
    values (c.user_id, 'like', ttl, snippet, link,
            'like:' || c.id || ':' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24'))
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;
