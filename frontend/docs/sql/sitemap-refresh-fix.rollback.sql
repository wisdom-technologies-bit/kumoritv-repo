-- Rollback for docs/sql/sitemap-refresh-fix.sql (Prompt 39B Part 1).
--
-- RUN THIS AS ONE PASTE in the Supabase SQL editor. It restores the ORIGINAL
-- text-returning refresh_sitemap_episodes() from docs/sql/sitemap-chunks.sql and
-- removes the refresh log. The materialized view and its data are untouched, so
-- the sitemaps keep working throughout.
--
-- Why the DROP: the current function returns jsonb; the original returns text.
-- `create or replace` cannot change a return type (SQLSTATE 42P13), so the
-- function has to be dropped before the old body is recreated - exactly the bug
-- this rollback has to avoid itself. Drop + create in the same paste is atomic.
--
-- The app does not need a redeploy: /api/cron/sitemap-refresh understands both
-- results (a text mode, or a jsonb object with mode/rows), so the cron keeps
-- working before, during and after this rollback.

-- 1. Drop the log-writing jsonb function, then restore the old text one.
drop function if exists public.refresh_sitemap_episodes();

create function public.refresh_sitemap_episodes()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('lock_timeout', '15s', true);
  begin
    refresh materialized view concurrently public.sitemap_episodes_ranked;
    return 'concurrent';
  exception
    when others then
      -- inside PostgREST's transaction CONCURRENTLY is refused; a plain
      -- refresh is the only option there.
      refresh materialized view public.sitemap_episodes_ranked;
      return 'full';
  end;
end;
$$;

revoke all on function public.refresh_sitemap_episodes() from public, anon, authenticated;
grant execute on function public.refresh_sitemap_episodes() to service_role;

-- 2. Remove the log table (only after the function that writes to it is gone).
drop table if exists public.sitemap_refresh_log;

-- 3. Verify: a refresh still works and returns text again.
select public.refresh_sitemap_episodes();
