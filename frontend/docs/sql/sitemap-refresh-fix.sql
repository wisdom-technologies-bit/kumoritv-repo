-- KumoriTV Fixes 39, Part D - sitemap refresh, made observable and idempotent.
--
-- RUN THIS AS ONE PASTE in the Supabase SQL editor (SQL Editor -> New query ->
-- paste the whole file -> Run). One paste means one transaction: the function is
-- never left missing, and re-running the file always lands the same definition.
--
-- Symptom: /sitemaps/episodes-14.xml lists 8,487 URLs forever, although the
-- catalogue keeps growing. 13 * 10,000 + 8,487 = 138,487 rows, which is
-- max(rn) on public.sitemap_episodes_ranked: the materialized view is frozen.
-- The XML is valid, complete and simply too old - nothing in the app said so,
-- because the refresh route recorded a FAILED refresh as a successful cron run.
-- (Live numbers 2026-11-15: sitemap_episodes 145,740 rows,
--  sitemap_episodes_ranked 138,487 rows, so the view is 7,253 rows behind.)
--
-- RUN ORDER (the section numbers below are in run order):
--   1. run SECTION 0 (diagnostics) and keep the output: it proves which case
--      you are in (stale view vs. a view filter that drops new rows).
--   2. run SECTION 1 and SECTION 2 of this file (they are idempotent).
--   3. deploy the app change (the route now fails loudly and reports health).
--   4. run SECTION 3 (one manual refresh) and then SECTION 4 (verify).
--   (Pasting the whole file at once is fine: SECTION 0 and 4 are read-only.)
--
-- PRE-CONDITION: docs/sql/sitemap-chunks.sql has been run, so
-- public.sitemap_episodes_ranked exists with its unique indexes.
--
-- IDEMPOTENT BY DESIGN: the table, its columns, its RLS/grants, the unique index
-- and the function are all created or replaced on every run. The function is
-- DROPPED first on purpose: this file changes its return type from text to
-- jsonb, and PostgreSQL refuses that with CREATE OR REPLACE alone (SQLSTATE
-- 42P13, "cannot change return type of existing function"). The drop and the
-- create are in the same paste, so there is no window where the cron misses it.
--
-- Safe to run more than once. No data is deleted. Nothing here touches
-- sitemap_episodes, episodes or any table the site reads.

-- =====================================================================
-- SECTION 0 - diagnostics (read-only, run first and keep the numbers)
-- =====================================================================

-- (a) how many rows the live view can produce, right now
select count(*) as sitemap_episodes_rows from public.sitemap_episodes;

-- (b) how many the materialized view actually has, and where it stops
select count(*) as ranked_rows, max(rn) as ranked_max_rn
from public.sitemap_episodes_ranked;

-- (c) the difference: positive means the matview is BEHIND the catalogue
select (select count(*) from public.sitemap_episodes)
     - coalesce((select max(rn) from public.sitemap_episodes_ranked), 0) as difference;

-- (d) do new episodes even qualify? If with_no_providers is large, the view's
--     provider requirement is the cause (case c), not a missing refresh.
select count(*) as episodes_total,
       count(*) filter (where coalesce(array_length(sub_providers, 1), 0) > 0) as with_sub_providers,
       count(*) filter (where coalesce(array_length(dub_providers, 1), 0) > 0) as with_dub_providers,
       count(*) filter (where coalesce(array_length(sub_providers, 1), 0) = 0
                          and coalesce(array_length(dub_providers, 1), 0) = 0) as with_no_providers
from public.episodes;

-- (e) when did the function last actually run? (needs SECTION 1 to have run)
-- select * from public.sitemap_refresh_log order by id desc limit 10;

-- =====================================================================
-- SECTION 1 - a refresh log, so "when did it last work" is answerable
-- =====================================================================

create table if not exists public.sitemap_refresh_log (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  refreshed_at timestamptz,
  finished_at timestamptz,
  ok boolean not null default false,
  mode text,              -- 'concurrent' | 'full' | 'failed'
  rows bigint,
  elapsed_ms integer,
  error text
);

-- If an earlier draft of this file created the table without a column, add it.
-- (add column if not exists is a no-op on every later run.)
alter table public.sitemap_refresh_log add column if not exists started_at timestamptz not null default now();
alter table public.sitemap_refresh_log add column if not exists refreshed_at timestamptz;
alter table public.sitemap_refresh_log add column if not exists finished_at timestamptz;
alter table public.sitemap_refresh_log add column if not exists ok boolean not null default false;
alter table public.sitemap_refresh_log add column if not exists mode text;
alter table public.sitemap_refresh_log add column if not exists rows bigint;
alter table public.sitemap_refresh_log add column if not exists elapsed_ms integer;
alter table public.sitemap_refresh_log add column if not exists error text;

comment on table public.sitemap_refresh_log is
  'One row per refresh_sitemap_episodes() call. Read by /api/cron/sitemap-check and /api/cron/status.';

alter table public.sitemap_refresh_log enable row level security;
revoke all on public.sitemap_refresh_log from anon, authenticated;

-- CONCURRENTLY needs a unique index on the view. docs/sql/sitemap-chunks.sql
-- already creates this exact index, so on a database where it exists this
-- statement is skipped instead of failing.
create unique index if not exists sitemap_episodes_ranked_rn_key
  on public.sitemap_episodes_ranked (rn);

-- =====================================================================
-- SECTION 2 - the function: logs every attempt, never fails silently
-- =====================================================================

-- PART 1 fix: DROP before CREATE. `create or replace` cannot change a return
-- type (text -> jsonb) and fails with 42P13 on the live database. The drop also
-- drops the old grants, which the REVOKE/GRANT after the create re-apply.
drop function if exists public.refresh_sitemap_episodes();

create function public.refresh_sitemap_episodes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_started timestamptz := clock_timestamp();
  v_rows bigint;
  v_mode text := 'concurrent';
  v_error text;
begin
  insert into public.sitemap_refresh_log (started_at, mode)
  values (v_started, 'concurrent')
  returning id into v_id;

  -- A plain REFRESH takes ACCESS EXCLUSIVE: give sitemap readers time to finish
  -- instead of failing instantly, and cap the whole statement.
  perform set_config('lock_timeout', '30s', true);
  perform set_config('statement_timeout', '120s', true);

  begin
    -- REFRESH ... CONCURRENTLY cannot run inside a transaction block, which is
    -- what PostgREST gives a function (and what this SQL editor gives this
    -- paste). Try it anyway (a future direct caller may allow it), then fall
    -- back to the blocking refresh.
    execute 'refresh materialized view concurrently public.sitemap_episodes_ranked';
  exception when others then
    v_error := sqlerrm;
    v_mode := 'full';
    begin
      execute 'refresh materialized view public.sitemap_episodes_ranked';
    exception when others then
      update public.sitemap_refresh_log
         set finished_at = clock_timestamp(),
             ok = false,
             mode = 'failed',
             elapsed_ms = extract(milliseconds from clock_timestamp() - v_started)::int,
             error = sqlerrm
       where id = v_id;
      raise;
    end;
  end;

  select count(*) into v_rows from public.sitemap_episodes_ranked;

  update public.sitemap_refresh_log
     set finished_at = clock_timestamp(),
         refreshed_at = clock_timestamp(),
         ok = true,
         mode = v_mode,
         rows = v_rows,
         elapsed_ms = extract(milliseconds from clock_timestamp() - v_started)::int,
         error = v_error
   where id = v_id;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'rows', v_rows,
    'elapsed_ms', extract(milliseconds from clock_timestamp() - v_started)::int,
    'concurrent_error', v_error
  );
end;
$$;

revoke all on function public.refresh_sitemap_episodes() from public, anon, authenticated;
grant execute on function public.refresh_sitemap_episodes() to service_role;

-- =====================================================================
-- SECTION 3 - refresh once, by hand (after Section 2, before verifying)
-- =====================================================================
-- Returns {"ok":true,"mode":"full"|"concurrent","rows":<count>,...}. `rows` is
-- what the sitemap chunks will list from now on.

select public.refresh_sitemap_episodes();

-- =====================================================================
-- SECTION 4 - verify
-- =====================================================================

select * from public.sitemap_refresh_log order by id desc limit 5;

select count(*) as sitemap_episodes_rows from public.sitemap_episodes;
select count(*) as ranked_rows, max(rn) as ranked_max_rn from public.sitemap_episodes_ranked;
select (select count(*) from public.sitemap_episodes)
     - coalesce((select max(rn) from public.sitemap_episodes_ranked), 0) as difference_after_refresh;
-- difference_after_refresh should be 0 (or within 1% while the catalogue moves).

-- Then, from Termux:
--   curl -s -H "x-cron-secret: $CRON_SECRET" \
--     "https://kumoritv.top/api/cron/sitemap-check" | jq '.health'
--   curl -s https://kumoritv.top/sitemaps/episodes-15.xml | grep -o "<loc>" | wc -l
