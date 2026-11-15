-- Rollback for docs/sql/sitemap-refresh-fix.sql (Part D).
-- This only removes the logging table and the log-writing function body; the
-- materialized view and its data are untouched, so the sitemaps keep working.

drop function if exists public.refresh_sitemap_episodes();
drop table if exists public.sitemap_refresh_log;

-- After this, recreate the previous function from docs/sql/sitemap-chunks.sql
-- if you need the refresh back.
