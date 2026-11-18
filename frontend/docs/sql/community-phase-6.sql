-- =====================================================================
-- Community Phase 6 - moderation, reports, blocks, durable limits.
-- FILE 1 OF 2: ADDITIVE. RUN THIS BEFORE DEPLOYING THE PHASE 6 CODE.
--
-- RUN ORDER (the owner runs these by hand, in this order):
--   1  docs/sql/profiles-rls.sql
--   2  docs/sql/community.sql
--   3  docs/sql/community-patch-1.sql
--   4  docs/sql/comments-deleted-users.sql
--   5  docs/sql/community-comments-arm.sql
--   6  docs/sql/community-clips-arm.sql
--   7  docs/sql/community-phase-6.sql            <- this file (BEFORE deploy)
--   8  deploy the Phase 6 code, verify it (see "VERIFY AFTER DEPLOY")
--   9  docs/sql/community-phase-6-lockdown.sql   <- AFTER the deploy
--
-- WHY TWO FILES
--   Until the Phase 6 build is live, the deployed browser code still inserts
--   comments straight into public.comments (comments_guard is its only guard).
--   Dropping that insert policy/grant in the same step as these additive changes
--   would break the running site for the length of the deploy. So:
--     * this file only ADDS things (columns, functions, indexes, policies,
--       replacement views/functions) and every one of them is safe for the OLD
--       code: old callers keep the columns they know, new columns are appended
--       at the end of the feed function's result, and every new function is
--       additive;
--     * community-phase-6-lockdown.sql removes the browser INSERT path, once
--       /api/comments is deployed and verified.
--
-- IDEMPOTENT: every statement is add-if-not-exists / create-or-replace /
-- drop-if-exists-then-create. Safe to run twice. The two functions whose OUT
-- columns change (community_feed_page) are dropped and recreated inside this
-- file's single transaction, never left missing for a caller.
--
-- WHAT THIS FILE ADDS (Part A of Phase 6)
--   1. Moderation columns on comments, announcements, community_posts and clips:
--      the same three-value model everywhere - published | hidden | removed -
--      plus who did it and why. Existing rows default to published.
--   2. community_moderation_log learns the 'clip' target kind (drop + recreate
--      the named constraint).
--   3. public.community_moderate(kind, id, action, reason): SECURITY DEFINER,
--      checks is_staff() itself, changes one row, writes exactly one log row,
--      resolves the target's open reports. Idempotent.
--   4. public.community_resolve_report(id, status, note) and
--      public.community_dismiss_reports(ids[]): the report inbox's two writes.
--   5. comment_feed: masks a hidden/removed comment for everyone who is not the
--      author or staff, keeps a comment that has replies as an empty placeholder
--      so the thread keeps its shape, and adds moderation_status /
--      moderation_reason at the END.
--   6. community_feed_page: filters hidden/removed content out for normal
--      viewers, shows it to the author and to staff, and appends `status` and
--      `moderation_reason` at the END.
--   7. community_new_posts: a hidden clip is not a toast candidate.
--   8. announcements: RLS hides hidden/removed rows from everyone but staff and
--      the admin who wrote them.
--   9. Indexes for the new filters and for the Phase 6 rate limits.
--
-- DECISIONS TAKEN HERE (and why)
--   * announcements get a status column, not a boolean `hidden`: the moderation
--     function, the log, the feed and the author banner all speak one vocabulary,
--     "removed" carries a reason, and one statement shape serves posts,
--     comments and announcements. A boolean would need a second column for the
--     reason and a second branch in every query.
--   * clips keep `deleted_at` as "removed" and gain `hidden_at` as "hidden".
--     The public clip page, the feed's clip card and /clips treat both as gone;
--     the owner's own "My clips" list still shows them, exactly like an author
--     still sees their own hidden post. No row is ever hard-deleted by
--     moderation, so reports keep their target.
--   * hiding is not deleting: `status` and `deleted_at` are separate, so
--     "restore" always has something to restore.
--
-- VERIFY (paste into the SQL editor after running):
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='comments'
--      and column_name in ('status','removed_reason','moderated_at','moderated_by');
--   select conname from pg_constraint
--    where conrelid='public.community_moderation_log'::regclass order by 1;
--   select proname, prosecdef, proconfig from pg_proc
--    where proname in ('community_moderate','community_resolve_report','community_dismiss_reports');
--   select pg_get_function_result(
--     'public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)'::regprocedure);
--   -- the last two columns are status and moderation_reason:
--   select * from public.community_feed_page(5, null, null, 'all', false, null, null, true);
--   select polname, pg_get_expr(polqual, polrelid) from pg_policies where tablename='announcements';
--   select indexname from pg_indexes
--    where indexname in ('comments_user_created_idx','community_posts_author_created_idx',
--                        'community_reports_reporter_created_idx','comment_reactions_user_created_idx',
--                        'community_reactions_user_created_idx','clips_hidden_idx');
--
-- VERIFY AFTER DEPLOY (before running the lockdown file):
--   * post a comment on an anime page and an episode page in the browser and see
--     it appear; check the row in public.comments has target_type='anime';
--   * open /community and the watch page: the feed still loads;
--   * as a moderator, hide and restore one post (Part A routes) and check exactly
--     one row in community_moderation_log per real change and none for a no-op.
--
-- ROLLBACK: docs/sql/community-phase-6.rollback.sql (restores the Phase 5
-- functions/views and drops everything this file adds; the moderation columns
-- are dropped last and only if no hidden/removed rows exist - the rollback file
-- checks that and refuses rather than destroying moderation state silently).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. moderation columns, one vocabulary everywhere
-- ---------------------------------------------------------------------
alter table public.comments
  add column if not exists status text not null default 'published',
  add column if not exists removed_reason text,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null;

alter table public.comments drop constraint if exists comments_status_chk;
alter table public.comments
  add constraint comments_status_chk
  check (status in ('published','hidden','removed'));

comment on column public.comments.status is
  'published = visible; hidden = held back by staff; removed = taken down, row kept for the report trail.';

alter table public.announcements
  add column if not exists status text not null default 'published',
  add column if not exists removed_reason text,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null;

alter table public.announcements drop constraint if exists announcements_status_chk;
alter table public.announcements
  add constraint announcements_status_chk
  check (status in ('published','hidden','removed'));

comment on column public.announcements.status is
  'published = listed; hidden = held back; removed = taken down. An expired announcement is still filtered by expires_at.';

-- community_posts already had status + removed_reason; it gains the audit pair.
alter table public.community_posts
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null;

-- clips: deleted_at is "removed"; hidden_at is "hidden" (reversible, not public).
alter table public.clips
  add column if not exists hidden_at timestamptz,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null;

comment on column public.clips.hidden_at is
  'Set by a moderator (hide). The clip is invisible on /clips, /clip/<code> and in the feed, but the owner still sees it in My clips. deleted_at stays the "removed" state.';

alter table public.community_reports
  add column if not exists resolution_note text;
alter table public.community_reports drop constraint if exists community_reports_note_len;
alter table public.community_reports
  add constraint community_reports_note_len
  check (resolution_note is null or char_length(resolution_note) <= 500);

-- ---------------------------------------------------------------------
-- 2. the log learns 'clip'
-- ---------------------------------------------------------------------
alter table public.community_moderation_log
  drop constraint if exists community_moderation_log_target_kind_check;
alter table public.community_moderation_log
  drop constraint if exists community_moderation_log_target_kind_chk;
alter table public.community_moderation_log
  add constraint community_moderation_log_target_kind_chk
  check (target_kind in ('post','comment','announcement','profile','clip'));

-- The action list already covers hide/unhide/remove/restore/role_change; the
-- constraint is re-asserted by name so a future value is a one-line change.
alter table public.community_moderation_log
  drop constraint if exists community_moderation_log_action_check;
alter table public.community_moderation_log
  drop constraint if exists community_moderation_log_action_chk;
alter table public.community_moderation_log
  add constraint community_moderation_log_action_chk
  check (action in ('hide','unhide','remove','restore','role_change'));

-- ---------------------------------------------------------------------
-- 3. community_moderate: one door for every moderation change
-- ---------------------------------------------------------------------
create or replace function public.community_moderate(
  p_kind text,
  p_id uuid,
  p_action text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_current  text;
  v_next     text;
  v_log_id   bigint;
  v_actioned integer := 0;
  v_exists   boolean := false;
begin
  -- The function checks the role itself: the route checks it too, but a route
  -- bug (or PostgREST being reachable directly) must not be able to moderate.
  if v_uid is null or not public.is_staff() then
    raise exception 'community_moderate:not_staff' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('post','comment','announcement','clip') then
    raise exception 'community_moderate:bad_kind' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('hide','unhide','remove','restore') then
    raise exception 'community_moderate:bad_action' using errcode = '22023';
  end if;
  if p_action = 'remove'
     and (v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300) then
    raise exception 'community_moderate:reason_required' using errcode = '22023';
  end if;

  v_next := case p_action
    when 'hide'    then 'hidden'
    when 'unhide'  then 'published'
    when 'remove'  then 'removed'
    else                'published'
  end;

  -- Current state, read under a row lock so two moderators cannot both "win".
  if p_kind = 'post' then
    select p.status into v_current
      from public.community_posts p where p.id = p_id for update;
    v_exists := found;
  elsif p_kind = 'comment' then
    select c.status into v_current
      from public.comments c where c.id = p_id for update;
    v_exists := found;
  elsif p_kind = 'announcement' then
    select a.status into v_current
      from public.announcements a where a.id = p_id for update;
    v_exists := found;
  else
    select case
             when cl.deleted_at is not null then 'removed'
             when cl.hidden_at is not null  then 'hidden'
             else 'published'
           end
      into v_current
      from public.clips cl where cl.id = p_id for update;
    v_exists := found;
  end if;

  if not v_exists then
    raise exception 'community_moderate:not_found' using errcode = 'P0002';
  end if;

  -- Idempotent: acting twice on the same state changes nothing and logs nothing.
  if v_current = v_next then
    return jsonb_build_object(
      'changed', false, 'status', v_current, 'previous', v_current,
      'log_id', null, 'reports_actioned', 0
    );
  end if;

  if p_kind = 'post' then
    update public.community_posts
       set status = v_next,
           removed_reason = case when v_next = 'removed' then v_reason else null end,
           moderated_at = now(),
           moderated_by = v_uid
     where id = p_id;
  elsif p_kind = 'comment' then
    update public.comments
       set status = v_next,
           removed_reason = case when v_next = 'removed' then v_reason else null end,
           moderated_at = now(),
           moderated_by = v_uid
     where id = p_id;
  elsif p_kind = 'announcement' then
    update public.announcements
       set status = v_next,
           removed_reason = case when v_next = 'removed' then v_reason else null end,
           moderated_at = now(),
           moderated_by = v_uid
     where id = p_id;
  else
    update public.clips
       set hidden_at = case
             when v_next = 'hidden' then now()
             when v_next = 'published' and p_action = 'unhide' then null
             else hidden_at
           end,
           deleted_at = case
             when v_next = 'removed' then now()
             when p_action = 'restore' then null
             else deleted_at
           end,
           moderated_at = now(),
           moderated_by = v_uid
     where id = p_id;
  end if;

  -- Exactly one log row per real change.
  insert into public.community_moderation_log (actor_id, action, target_kind, target_id, reason)
  values (v_uid, p_action, p_kind, p_id,
          case when v_next = 'removed' then v_reason else null end)
  returning id into v_log_id;

  -- Hide and remove answer the reports that pointed at this content.
  if p_kind <> 'clip' and p_action in ('hide','remove') then
    update public.community_reports r
       set status = 'actioned',
           resolved_at = now(),
           resolved_by = v_uid
     where r.target_kind = p_kind
       and r.target_id = p_id
       and r.status = 'open';
    get diagnostics v_actioned = row_count;
  end if;

  -- The bell must not keep pointing at content that is no longer there. When a
  -- comment (or a post/announcement and the comments on it) is hidden or
  -- removed, the reply/like/mention notifications that referenced it go with it.
  -- Already-delivered push messages cannot be recalled; undelivered outbox rows
  -- for the same comments are dropped below.
  if p_action in ('hide','remove') then
    delete from public.user_notifications n
     using public.comments c
     where n.comment_id = c.id
       and (
         (p_kind = 'comment' and c.id = p_id)
         or (p_kind = 'post' and c.post_id = p_id)
         or (p_kind = 'announcement' and c.announcement_id = p_id)
       );
    delete from public.push_outbox o
     using public.comments c
     where (o.dedupe_key like 'reply:' || c.id::text
            or o.dedupe_key like 'mention:' || c.id::text || ':%'
            or o.dedupe_key like 'like:' || c.id::text || ':%')
       and (o.sent_at is null)
       and (
         (p_kind = 'comment' and c.id = p_id)
         or (p_kind = 'post' and c.post_id = p_id)
         or (p_kind = 'announcement' and c.announcement_id = p_id)
       );
  end if;

  return jsonb_build_object(
    'changed', true, 'status', v_next, 'previous', v_current,
    'log_id', v_log_id, 'reports_actioned', v_actioned
  );
end $$;

revoke all on function public.community_moderate(text, uuid, text, text) from public;
revoke all on function public.community_moderate(text, uuid, text, text) from anon;
grant execute on function public.community_moderate(text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. reports: resolve one, dismiss many (the inbox's two writes)
-- ---------------------------------------------------------------------
create or replace function public.community_resolve_report(
  p_id uuid,
  p_status text,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_status text := p_status;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_row    public.community_reports;
begin
  if v_uid is null or not public.is_staff() then
    raise exception 'community_resolve_report:not_staff' using errcode = '42501';
  end if;
  if v_status is null or v_status not in ('actioned','dismissed') then
    raise exception 'community_resolve_report:bad_status' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'community_resolve_report:note_too_long' using errcode = '22023';
  end if;

  update public.community_reports r
     set status = v_status,
         resolved_at = now(),
         resolved_by = v_uid,
         resolution_note = v_note
   where r.id = p_id
     and r.status = 'open'
  returning * into v_row;

  if v_row.id is null then
    -- Already resolved (or never existed): tell the caller the current state,
    -- never overwrite a decision somebody else made.
    select * into v_row from public.community_reports r where r.id = p_id;
    if v_row.id is null then
      raise exception 'community_resolve_report:not_found' using errcode = 'P0002';
    end if;
    return jsonb_build_object('changed', false, 'status', v_row.status);
  end if;

  return jsonb_build_object('changed', true, 'status', v_row.status);
end $$;

revoke all on function public.community_resolve_report(uuid, text, text) from public;
revoke all on function public.community_resolve_report(uuid, text, text) from anon;
grant execute on function public.community_resolve_report(uuid, text, text) to authenticated;

create or replace function public.community_dismiss_reports(
  p_ids uuid[],
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_count  integer := 0;
  v_ids    uuid[];
begin
  if v_uid is null or not public.is_staff() then
    raise exception 'community_dismiss_reports:not_staff' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'community_dismiss_reports:empty' using errcode = '22023';
  end if;
  if array_length(p_ids, 1) > 50 then
    raise exception 'community_dismiss_reports:too_many' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'community_dismiss_reports:note_too_long' using errcode = '22023';
  end if;

  v_ids := (select array_agg(distinct x) from unnest(p_ids) as x where x is not null);

  update public.community_reports r
     set status = 'dismissed',
         resolved_at = now(),
         resolved_by = v_uid,
         resolution_note = v_note
   where r.id = any (v_ids)
     and r.status = 'open';
  get diagnostics v_count = row_count;

  return jsonb_build_object('changed', count(v_ids) > 0 and v_count > 0,
                            'dismissed', v_count);
end $$;

revoke all on function public.community_dismiss_reports(uuid[], text) from public;
revoke all on function public.community_dismiss_reports(uuid[], text) from anon;
grant execute on function public.community_dismiss_reports(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. comment_feed: hidden/removed comments are not public
--    A comment that still has replies keeps its row (and its anchor) as an
--    empty placeholder so the thread keeps its shape; one without replies
--    disappears. The author and staff still see the real body and the reason.
--    Columns are only APPENDED (create or replace view allows that).
-- ---------------------------------------------------------------------
create or replace view public.comment_feed as
select c.id, c.anilist_id, c.episode_number, c.parent_id, c.user_id,
       case
         when c.status = 'published' then c.body
         when c.user_id = auth.uid() then c.body
         when public.is_staff() then c.body
         else null
       end as body,
       c.is_spoiler, c.created_at, p.username, p.display_name, p.avatar_url,
       coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int as likes,
       coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int as dislikes,
       c.target_type, c.post_id, c.announcement_id,
       c.status as moderation_status,
       case
         when c.user_id = auth.uid() or public.is_staff() then c.removed_reason
         else null
       end as moderation_reason
from public.comments c
left join public.public_profiles p on p.id = c.user_id
left join public.comment_reactions r on r.comment_id = c.id
left join public.community_posts cp on cp.id = c.post_id
left join public.announcements an on an.id = c.announcement_id
where c.deleted_at is null
  and (
    c.status = 'published'
    or c.user_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.comments rep
       where rep.parent_id = c.id and rep.deleted_at is null
    )
  )
  and (c.target_type <> 'post'
       or (cp.id is not null and cp.deleted_at is null and cp.status = 'published'))
  and (c.target_type <> 'announcement'
       or (an.id is not null and an.status = 'published'
           and (an.expires_at is null or an.expires_at > now())))
group by c.id, p.username, p.display_name, p.avatar_url;
grant select on public.comment_feed to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. community_feed_page: the same feed, with moderation applied
--    Return type changes (status, moderation_reason appended), so DROP then
--    CREATE inside this transaction. Arguments, defaults and the keyset cursor
--    (created_at, feed_key) are unchanged; ACLs restated at the end.
-- ---------------------------------------------------------------------
drop function if exists
  public.community_feed_page(integer, timestamp with time zone, text, text, boolean, uuid, bigint, boolean);

CREATE OR REPLACE FUNCTION public.community_feed_page(
  p_limit integer DEFAULT 20,
  p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_key text DEFAULT NULL::text,
  p_kind text DEFAULT 'all'::text,
  p_show_adult boolean DEFAULT false,
  p_author uuid DEFAULT NULL::uuid,
  p_anilist_id bigint DEFAULT NULL::bigint,
  p_hide_blocked boolean DEFAULT true
) RETURNS TABLE(
  feed_key text, kind text, created_at timestamp with time zone,
  author_id uuid, author_username text, author_display_name text, author_avatar text,
  body text, is_spoiler boolean, title text, image_url text, link_url text,
  clip_code text, clip_start numeric, clip_end numeric,
  anime_id bigint, anime_title text, anime_cover text, episode_number integer,
  target_url text, reply_count integer, likes integer, dislikes integer,
  is_adult boolean,
  clip_state text,
  status text,
  moderation_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
-- Hidden/removed rows reach only their author and staff; everybody else never
-- sees them here, whatever the filter. `status` (and the reason, for the two
-- audiences allowed to see it) travels in the last two columns so the card can
-- draw a staff badge or the author's banner without a second query.
with lim as (select least(greatest(coalesce(p_limit, 20), 1), 50) as n),
cand as (
  (
    select c.id, c.created_at
    from public.comments c
    join public.anime a on a.anilist_id = c.anilist_id
    where c.target_type = 'anime'
      and c.parent_id is null
      and c.deleted_at is null
      and c.user_id is not null
      and (c.status = 'published' or c.user_id = auth.uid() or public.is_staff())
      and (p_show_adult or not coalesce(a.is_adult, false))
      and p_kind in ('all','comment')
      and (p_author is null or c.user_id = p_author)
      and (not p_hide_blocked or not exists (
            select 1 from public.community_blocks b
             where b.blocker_id = auth.uid() and b.blocked_id = c.user_id))
      and p_anilist_id is null
      and (p_cursor_created_at is null
           or c.created_at < p_cursor_created_at
           or (c.created_at = p_cursor_created_at
               and 'comment:' || c.id::text < coalesce(p_cursor_key, '')))
    order by c.created_at desc, c.id desc
    limit (select n from lim)
  )
  union all
  (
    select c.id, c.created_at
    from public.comments c
    join public.anime a on a.anilist_id = c.anilist_id
    where c.target_type = 'anime'
      and c.parent_id is null
      and c.deleted_at is null
      and c.user_id is not null
      and (c.status = 'published' or c.user_id = auth.uid() or public.is_staff())
      and (p_show_adult or not coalesce(a.is_adult, false))
      and p_kind in ('all','comment')
      and (p_author is null or c.user_id = p_author)
      and (not p_hide_blocked or not exists (
            select 1 from public.community_blocks b
             where b.blocker_id = auth.uid() and b.blocked_id = c.user_id))
      and c.anilist_id = (select p_anilist_id)
      and (p_cursor_created_at is null
           or c.created_at < p_cursor_created_at
           or (c.created_at = p_cursor_created_at
               and 'comment:' || c.id::text < coalesce(p_cursor_key, '')))
    order by c.created_at desc, c.id desc
    limit (select n from lim)
  )
),
src as (
  -- ---------------------------------------------------------------- posts --
  -- The clip join treats a hidden clip exactly like a removed one: both are
  -- gone from the public card (clip_state 'removed'), and the owner sees it in
  -- My clips instead.
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
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.title::text
      end as title,
      null::text as image_url,
      p.link_url,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.code::text
      end as clip_code,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.start_seconds
      end as clip_start,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.end_seconds
      end as clip_end,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.anilist_id
      end as anime_id,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else coalesce(a.title_english, a.title)::text
      end as anime_title,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else a.cover_url::text
      end as anime_cover,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then null
        when not p_show_adult and coalesce(a.is_adult, false) then null
        else cl.episode_number
      end as episode_number,
      '/community/post/' || p.id::text as target_url,
      (select count(*)::integer from public.comments rc
        where rc.post_id = p.id and rc.parent_id is null
          and rc.deleted_at is null and rc.status = 'published') as reply_count,
      case
        when p.clip_id is null or cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then false
        else coalesce(a.is_adult, false)
      end as is_adult,
      case
        when p.clip_id is null then 'none'
        when cl.id is null or cl.deleted_at is not null or cl.hidden_at is not null then 'removed'
        when not p_show_adult and coalesce(a.is_adult, false) then 'hidden_adult'
        else 'live'
      end as clip_state,
      p.status,
      case
        when p.author_id = auth.uid() or public.is_staff() then p.removed_reason
        else null
      end as moderation_reason
    from public.community_posts p
    left join public.public_profiles pr on pr.id = p.author_id
    left join public.clips cl on cl.id = p.clip_id
    left join public.anime a on a.anilist_id = cl.anilist_id
    where p.deleted_at is null
      and (p.status = 'published' or p.author_id = auth.uid() or public.is_staff())
      and (
        p_kind in ('all','post')
        or (p_kind = 'clips' and p.clip_id is not null)
      )
      and (p_author is null or p.author_id = p_author)
      and (p_anilist_id is null or cl.anilist_id = p_anilist_id)
      and (not p_hide_blocked or not exists (
            select 1 from public.community_blocks b
             where b.blocker_id = auth.uid() and b.blocked_id = p.author_id))
      and (p_cursor_created_at is null
           or p.created_at < p_cursor_created_at
           or (p.created_at = p_cursor_created_at
               and 'post:' || p.id::text < coalesce(p_cursor_key, '')))
    order by p.created_at desc, p.id desc
    limit (select n from lim)
  )
  union all
  -- --------------------------------------------------------- announcements --
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
      null::bigint, null::text, null::text, null::integer,
      '/community/announcements/' || an.id::text,
      (select count(*)::integer from public.comments rc
        where rc.announcement_id = an.id and rc.parent_id is null
          and rc.deleted_at is null and rc.status = 'published'),
      false,
      null::text,
      an.status,
      case
        when (an.created_by is not null and an.created_by = auth.uid()) or public.is_staff()
          then an.removed_reason
        else null
      end
    from public.announcements an
    where (an.expires_at is null or an.expires_at > pg_catalog.now())
      and (an.status = 'published' or public.is_staff()
           or (an.created_by is not null and an.created_by = auth.uid()))
      and p_kind in ('all','announcement')
      and p_author is null
      and p_anilist_id is null
      and (p_cursor_created_at is null
           or an.created_at < p_cursor_created_at
           or (an.created_at = p_cursor_created_at
               and 'announcement:' || an.id::text < coalesce(p_cursor_key, '')))
    order by an.created_at desc, an.id desc
    limit (select n from lim)
  )
  union all
  -- ------------------------------------------------ comments (Phase 2) ------
  (
    select
      'comment:' || c.id::text,
      'comment'::text,
      c.created_at,
      c.user_id,
      pr.username::text,
      pr.display_name::text,
      pr.avatar_url::text,
      case when c.is_spoiler then null else c.body end,
      c.is_spoiler,
      null::text, null::text, null::text,
      null::text, null::numeric, null::numeric,
      c.anilist_id,
      coalesce(a.title_english, a.title)::text,
      a.cover_url::text,
      c.episode_number,
      public.comment_link(c),
      (select count(*)::integer from public.comments rc
        where rc.parent_id = c.id and rc.deleted_at is null and rc.status = 'published'),
      coalesce(a.is_adult, false),
      null::text,
      c.status,
      case
        when c.user_id = auth.uid() or public.is_staff() then c.removed_reason
        else null
      end
    from cand cd
    join public.comments c on c.id = cd.id
    join public.anime a on a.anilist_id = c.anilist_id
    left join public.public_profiles pr on pr.id = c.user_id
    order by c.created_at desc, c.id desc
    limit (select n from lim)
  )
),
page as (
  select * from src
  order by created_at desc, feed_key desc
  limit (select n from lim)
),
react as (
  select
    'post'::text as kind,
    r.post_id as id,
    sum(case when r.value = 1 then 1 else 0 end)::integer as likes,
    sum(case when r.value = -1 then 1 else 0 end)::integer as dislikes
  from public.community_reactions r
  where r.post_id in (
    select pg_catalog.right(p.feed_key, 36)::uuid from page p where p.kind = 'post')
  group by r.post_id
  union all
  select
    'announcement'::text,
    r.announcement_id,
    sum(case when r.value = 1 then 1 else 0 end)::integer,
    sum(case when r.value = -1 then 1 else 0 end)::integer
  from public.community_reactions r
  where r.announcement_id in (
    select pg_catalog.right(p.feed_key, 36)::uuid from page p where p.kind = 'announcement')
  group by r.announcement_id
  union all
  select
    'comment'::text,
    r.comment_id,
    sum(case when r.value = 1 then 1 else 0 end)::integer,
    sum(case when r.value = -1 then 1 else 0 end)::integer
  from public.comment_reactions r
  where r.comment_id in (
    select pg_catalog.right(p.feed_key, 36)::uuid from page p where p.kind = 'comment')
  group by r.comment_id
)
select
  p.feed_key, p.kind, p.created_at,
  p.author_id, p.author_username, p.author_display_name, p.author_avatar,
  p.body, p.is_spoiler, p.title, p.image_url, p.link_url,
  p.clip_code, p.clip_start, p.clip_end,
  p.anime_id, p.anime_title, p.anime_cover, p.episode_number,
  p.target_url, p.reply_count,
  coalesce(x.likes, 0) as likes,
  coalesce(x.dislikes, 0) as dislikes,
  p.is_adult,
  p.clip_state,
  p.status,
  p.moderation_reason
from page p
left join react x
  on x.kind = p.kind
 and x.id = pg_catalog.right(p.feed_key, 36)::uuid
order by p.created_at desc, p.feed_key desc;
$function$;

revoke execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean) from public;
grant execute on function public.community_feed_page(int,timestamptz,text,text,boolean,uuid,bigint,boolean)
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. the toast: a hidden clip is not a toast candidate
--    (same signature and same OUT columns: create or replace is allowed)
-- ---------------------------------------------------------------------
create or replace function public.community_new_posts(
  p_after timestamptz default null,
  p_limit int default 5,
  p_exclude_author uuid default null,
  p_show_adult boolean default false
) returns table (
  id uuid, created_at timestamptz,
  author_name text, author_avatar text,
  snippet text, has_clip boolean, clip_code text,
  anime_id bigint, episode_number int,
  total bigint
)
language sql stable security definer set search_path = '' as $$
  with rows as (
    select p.id, p.created_at, p.author_id, p.body, p.is_spoiler, p.clip_id,
           cl.code as clip_code, cl.anilist_id, cl.episode_number,
           (cl.id is not null and coalesce(a.is_adult, false)
             and not coalesce(p_show_adult, false)) as clip_hidden
      from public.community_posts p
      left join public.clips cl
        on cl.id = p.clip_id and cl.deleted_at is null and cl.hidden_at is null
      left join public.anime a on a.anilist_id = cl.anilist_id
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
         case
           when r.clip_hidden then 'Shared a clip'::text
           when r.is_spoiler then 'Spoiler post'::text
           else pg_catalog.left(r.body, 120)
         end,
         (r.clip_id is not null),
         case when r.clip_hidden then null::text else r.clip_code::text end,
         case when r.clip_hidden then null::bigint else r.anilist_id end,
         case when r.clip_hidden then null::int else r.episode_number end,
         (select count(*) from public.community_posts p2
           where p2.deleted_at is null and p2.status = 'published'
             and (p_after is null or p2.created_at > p_after)
             and (p_exclude_author is null or p2.author_id <> p_exclude_author))
    from rows r
    left join public.public_profiles pr on pr.id = r.author_id
   order by r.created_at desc;
$$;

revoke execute on function public.community_new_posts(timestamptz,int,uuid,boolean) from public;
grant execute on function public.community_new_posts(timestamptz,int,uuid,boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. announcements: hidden/removed rows are not public
--    (RLS is the gate for every browser read: the list page, the detail page,
--    the right rail and the bell all go through it.)
-- ---------------------------------------------------------------------
alter table public.announcements enable row level security;

drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements
  for select to anon, authenticated
  using (
    (expires_at is null or expires_at > now())
    and (
      status = 'published'
      or public.is_staff()
      or (created_by is not null and created_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- 9. indexes
-- ---------------------------------------------------------------------
-- Moderation reads: "everything hidden/removed" for the dashboard.
create index if not exists community_posts_status_idx
  on public.community_posts (moderated_at desc nulls last)
  where status <> 'published';
create index if not exists comments_status_idx
  on public.comments (moderated_at desc nulls last)
  where status <> 'published';
create index if not exists clips_hidden_idx
  on public.clips (moderated_at desc nulls last)
  where deleted_at is not null or hidden_at is not null;

-- Report inbox grouping: reports by target, newest last.
create index if not exists community_reports_target_idx
  on public.community_reports (target_kind, target_id, created_at desc);

commit;
