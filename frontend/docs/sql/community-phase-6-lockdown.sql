-- Phase 6, part E: LOCKDOWN. Run this ONLY after the Phase 6 code is deployed
-- and verified.
--
-- WHY THIS IS SEPARATE FROM community-phase-6.sql
--   The additive file is safe to run before the deploy: it only adds columns,
--   functions, policies and triggers, and the Phase 5 client keeps working.
--   This file takes something away - the browser's ability to write a comment
--   directly - so it must run after the new code (which writes through
--   /api/comments with the service role) is live. Run it before the deploy and
--   the old client's comments fail with a permission error.
--
-- ORDER
--   1  docs/sql/community-phase-6.sql          (before deploy)
--   2  deploy the Phase 6 code
--   3  verify comments, replies, spoiler toggle and delete in the UI
--   4  docs/sql/community-phase-6-lockdown.sql (this file)
--
-- WHAT IT DOES
--   1. Drops the "comments insert own" policy and revokes INSERT, UPDATE and
--      DELETE on public.comments from anon and authenticated. SELECT stays.
--      The only writer left is the service role, i.e. /api/comments and
--      /api/comments/<id>, which validate, filter profanity, apply the limits
--      and stamp user_id from the verified session.
--   2. Leaves comment_reactions alone: reactions are still a direct browser
--      write (one row per user per comment, RLS-checked) and Phase 6's reaction
--      guard already limits them at 60 a minute.
--   3. Keeps every read path untouched: comment_feed, listComments and the
--      counts all read public.comments and public.comment_feed, which still
--      have their SELECT grants and policies.
--
-- BEFORE YOU RUN IT, confirm the new path works:
--   select has_table_privilege('authenticated', 'public.comments', 'insert');
--   -- expect true before, false after
--   select polname from pg_policy where polrelid = 'public.comments'::regclass;
--   -- expect no 'comments insert own' after
--
-- AFTER, prove the old path is closed and the new one works:
--   -- as a normal user through the browser client: must fail
--   insert into public.comments (user_id, body, target_type, anilist_id)
--   values (auth.uid(), 'direct write', 'anime', 101);
--   -- through the app: POST /api/comments returns 201, the row appears in
--   -- comment_feed, and DELETE /api/comments/<id> soft-deletes it.
--
-- ROLLBACK: docs/sql/community-phase-6-lockdown.rollback.sql restores the
-- policy and the grants exactly as Phase 5 had them.

begin;

-- 1. the direct write path -------------------------------------------------
drop policy if exists "comments insert own" on public.comments;

revoke insert, update, delete on public.comments from anon;
revoke insert, update, delete on public.comments from authenticated;

-- SELECT is the read path for the section, the counts and the deep links.
grant select on public.comments to anon, authenticated;

commit;
