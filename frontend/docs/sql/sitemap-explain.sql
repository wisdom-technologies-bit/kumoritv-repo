-- ============================================================================
-- PROMPT 34 PART B - what the sitemap reads actually cost, before and after.
--
-- Read-only. Paste it in the Supabase SQL editor (or psql) and compare the
-- "Execution Time" lines. This is the evidence behind docs/sql/sitemap-chunks.sql.
--
-- WHAT IT SHOWS
--   1. The old read: `order by anilist_id, episode_number` + OFFSET 0 / 10,000 /
--      30,000 over the `sitemap_episodes` VIEW. A view is a stored query, so
--      every page re-runs the join + filter + sort from the beginning; the
--      deeper the page, the more rows Postgres produces and throws away.
--   2. The old count: `count(*)` over the same view (what the sitemap index
--      used to ask for with `count: 'exact'` on every crawler hit).
--   3. The new read: the same chunks as `rn between ...` ranges on
--      `sitemap_episodes_ranked` (a materialised view with a unique index on
--      rn) - an index range scan, so depth costs nothing.
--
-- If `sitemap_episodes_ranked` does not exist yet, run
-- docs/sql/sitemap-chunks.sql first; part 3 is skipped until then.
-- ============================================================================

-- 1. OLD: deep OFFSET over the view ------------------------------------------
explain (analyze, buffers, timing on)
select anilist_id, episode_number, updated_at, air_date
from public.sitemap_episodes
order by anilist_id, episode_number
offset 0 rows fetch next 1000 rows only;

explain (analyze, buffers, timing on)
select anilist_id, episode_number, updated_at, air_date
from public.sitemap_episodes
order by anilist_id, episode_number
offset 10000 rows fetch next 1000 rows only;

explain (analyze, buffers, timing on)
select anilist_id, episode_number, updated_at, air_date
from public.sitemap_episodes
order by anilist_id, episode_number
offset 30000 rows fetch next 1000 rows only;

-- 2. OLD: the count the index used to ask for -------------------------------
explain (analyze, buffers, timing on)
select count(*) from public.sitemap_episodes;

-- 3. NEW: the same chunks from the ranked materialised view ------------------
-- Chunk 1, 2 and 4 (chunk 4 is the short tail on a 35k-row table).
explain (analyze, buffers, timing on)
select rn, anilist_id, episode_number, updated_at, air_date
from public.sitemap_episodes_ranked
where rn between 1 and 1000
order by rn;

explain (analyze, buffers, timing on)
select rn, anilist_id, episode_number, updated_at, air_date
from public.sitemap_episodes_ranked
where rn between 10001 and 11000
order by rn;

explain (analyze, buffers, timing on)
select rn, anilist_id, episode_number, updated_at, air_date
from public.sitemap_episodes_ranked
where rn between 30001 and 31000
order by rn;

-- 3b. NEW: the index's chunk count, instead of count(*) on the view ----------
-- max(rn) is a single index step; ceil(max(rn)/10000) is the chunk count the
-- sitemap index lists.
explain (analyze, buffers, timing on)
select rn from public.sitemap_episodes_ranked order by rn desc limit 1;

-- 3c. NEW: per-chunk <lastmod> ----------------------------------------------
explain (analyze, buffers, timing on)
select updated_at from public.sitemap_episodes_ranked
where rn between 10001 and 20000
order by updated_at desc
limit 1;
