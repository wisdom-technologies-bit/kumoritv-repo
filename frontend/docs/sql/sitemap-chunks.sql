-- ============================================================================
-- PROMPT 34 PART B - make the episode sitemap chunks fast at any depth.
--
-- RUN THIS YOURSELF, ONCE, IN THE SUPABASE SQL EDITOR (it is idempotent).
-- Deploying the code before running it is safe: lib/sitemap.ts falls back to
-- the old `public.sitemap_episodes` view when the ranked view is missing.
--
-- WHY
-- `/sitemaps/episodes-N.xml` used to read the `sitemap_episodes` VIEW with
-- `.order(anilist_id, episode_number).range(offset, offset+999)` in up to ten
-- sequential 1000-row requests. A view has no storage, so every one of those
-- requests re-scanned and re-sorted `episodes` x `anime` from the start:
-- offset 0-9,999 answered in ~1.3-1.7 s, offset 10,000-39,999 in 6.8-7.9 s,
-- offset 40,000+ in 9.9-13.7 s, and the slowest ones came back as HTTP 500.
--
-- WHAT THIS DOES
-- `sitemap_episodes_ranked` materialises exactly those rows once, with a dense
-- `rn`, and a unique index on it. Chunk N is then the index range
-- `rn between (N-1)*10000+1 and N*10000`, which is an index range scan of
-- 10,000 rows - the same cost for chunk 1 and chunk 40, no OFFSET at all.
-- ============================================================================

-- 1. The ranked materialised view -------------------------------------------
-- Same rules the `sitemap_episodes` view applies: the episode is playable
-- (at least one sub or dub provider) and its anime row exists, so the /watch
-- URL always resolves. `rn` is dense and gap-free, which is what makes
-- "chunk N starts at (N-1)*size+1" true.
--
-- Dropped and recreated so re-running the file always lands the same
-- definition (Postgres has no CREATE OR REPLACE MATERIALIZED VIEW). The drop
-- takes an exclusive lock for a moment; the site only reads this object from
-- the sitemap routes, which handle the gap with their cache.

drop materialized view if exists public.sitemap_episodes_ranked;

create materialized view public.sitemap_episodes_ranked as
select
  row_number() over (order by e.anilist_id, e.episode_number)::bigint as rn,
  e.anilist_id,
  e.episode_number,
  e.updated_at,
  e.air_date
from public.episodes e
join public.anime a on a.anilist_id = e.anilist_id
where e.episode_number >= 1
  and (
    coalesce(jsonb_array_length(e.sub_providers), 0) > 0
    or coalesce(jsonb_array_length(e.dub_providers), 0) > 0
  )
with data;

-- 2. Indexes ----------------------------------------------------------------
-- UNIQUE on rn: the chunk range scan itself, and the requirement for
-- REFRESH MATERIALIZED VIEW CONCURRENTLY.
create unique index if not exists sitemap_episodes_ranked_rn_key
  on public.sitemap_episodes_ranked (rn);

-- UNIQUE on the natural key: the second requirement for CONCURRENTLY.
create unique index if not exists sitemap_episodes_ranked_media_ep_key
  on public.sitemap_episodes_ranked (anilist_id, episode_number);

-- Per-chunk <lastmod> (max updated_at inside a chunk): a descending index makes
-- the rn-range + order by updated_at desc + limit 1 read a handful of rows.
create index if not exists sitemap_episodes_ranked_updated_at_idx
  on public.sitemap_episodes_ranked (updated_at desc);

analyze public.sitemap_episodes_ranked;

-- 3. Permissions ------------------------------------------------------------
-- Only the server (service_role) reads this object and only it may refresh it.
grant select on public.sitemap_episodes_ranked to service_role;
revoke all on public.sitemap_episodes_ranked from anon, authenticated;

-- 4. Refresh entry point ----------------------------------------------------
-- Called by the cron route (app/api/cron/sitemap-refresh) every 30 minutes.
--
-- CONCURRENTLY does not block readers, but PostgreSQL refuses to run it inside
-- a transaction block - and a function called over PostgREST already is one.
-- So: try CONCURRENTLY first (it works when the owner runs this file directly
-- in the SQL editor or via psql), and fall back to a plain REFRESH, which takes
-- an ACCESS EXCLUSIVE lock for the duration of the rebuild. lock_timeout keeps
-- that wait short: if the lock cannot be had, the function raises and the cron
-- retries on its next tick instead of queueing behind the sitemap readers.

create or replace function public.refresh_sitemap_episodes()
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

-- 5. Health check -----------------------------------------------------------
-- One row you can eyeball after running this file: row count, highest rn (must
-- equal the row count - that is what proves the chunk maths), and how many
-- 10,000-row chunks the index should list.
select
  count(*)                                   as rows,
  max(rn)                                    as max_rn,
  count(*) = max(rn)                         as rn_is_dense,
  ceil(max(rn) / 10000.0)                    as episode_chunks
from public.sitemap_episodes_ranked;
