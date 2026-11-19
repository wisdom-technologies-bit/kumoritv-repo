-- Rollback for docs/sql/community-phase-6-lockdown.sql.
--
-- Restores exactly what Phase 5 had: the insert policy and the table grants.
-- Safe to run at any time: the API keeps working because it writes with the
-- service role, which bypasses both RLS and these grants.
begin;

grant insert, update, delete on public.comments to authenticated;

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

commit;
