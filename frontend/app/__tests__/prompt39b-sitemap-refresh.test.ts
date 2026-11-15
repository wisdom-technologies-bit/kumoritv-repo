// Prompt 39B Part 1: the refresh function changed its return type, so the SQL
// file has to drop it first, and the cron route has to read both shapes.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_REFRESH_OUTCOME,
  describeSitemapRefresh,
} from "@/app/lib/cron/sitemapRefreshResult";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const sql = () => read("docs/sql/sitemap-refresh-fix.sql");
const rollback = () => read("docs/sql/sitemap-refresh-fix.rollback.sql");

// ------------------------------------------------------------ the result shape

test("the old text-returning function is still understood", () => {
  assert.deepEqual(describeSitemapRefresh("concurrent"), {
    summary: "concurrent",
    mode: "concurrent",
    rows: null,
    concurrentError: null,
  });
  assert.equal(describeSitemapRefresh("full").mode, "full");
  assert.deepEqual(describeSitemapRefresh("  "), EMPTY_REFRESH_OUTCOME);
});

test("the new jsonb result is logged with mode and rows, not as the word ok", () => {
  const outcome = describeSitemapRefresh({
    ok: true,
    mode: "full",
    rows: 145740,
    elapsed_ms: 4210,
    concurrent_error: "REFRESH MATERIALIZED VIEW CONCURRENTLY cannot be executed from a function",
  });

  assert.equal(outcome.mode, "full");
  assert.equal(outcome.rows, 145740, "the row count survives instead of becoming 'ok'");
  assert.equal(outcome.summary, "full rows=145740");
  assert.match(outcome.concurrentError ?? "", /CONCURRENTLY cannot be executed/);
});

test("an absent row count stays absent and never becomes zero", () => {
  for (const rows of [null, undefined, ""]) {
    const outcome = describeSitemapRefresh({ ok: true, mode: "concurrent", rows });
    assert.equal(outcome.rows, null);
    assert.equal(outcome.summary, "concurrent");
  }
  // a genuine zero is reported as zero
  assert.equal(describeSitemapRefresh({ mode: "full", rows: 0 }).summary, "full rows=0");
  assert.equal(describeSitemapRefresh({ mode: "full", rows: "12" }).rows, 12);
});

test("anything else still reports something usable", () => {
  assert.deepEqual(describeSitemapRefresh(null), EMPTY_REFRESH_OUTCOME);
  assert.deepEqual(describeSitemapRefresh(undefined), EMPTY_REFRESH_OUTCOME);
  assert.deepEqual(describeSitemapRefresh(42), EMPTY_REFRESH_OUTCOME);
  assert.equal(describeSitemapRefresh({}).summary, "ok");
});

// --------------------------------------------------------------- the SQL file

test("the refresh route logs the mode and the row count", () => {
  const route = read("app/api/cron/sitemap-refresh/route.ts");
  assert.match(route, /describeSitemapRefresh/);
  assert.ok(!/typeof data === "string" \? data : "ok"/.test(route), "no more silent 'ok'");
  assert.match(route, /refreshMode/);
  assert.match(route, /refreshRows/);
  assert.match(route, /\[sitemap\] refresh mode=/);
});

test("the function is dropped before it is created, so 42P13 cannot happen", () => {
  const body = sql();
  const dropAt = body.indexOf("drop function if exists public.refresh_sitemap_episodes();");
  const createAt = body.indexOf("create function public.refresh_sitemap_episodes()");
  const revokeAt = body.indexOf("revoke all on function public.refresh_sitemap_episodes()");
  const grantAt = body.indexOf("grant execute on function public.refresh_sitemap_episodes()");

  assert.ok(dropAt > -1, "the file drops the old function");
  assert.ok(createAt > -1, "the file creates the new one");
  assert.ok(dropAt < createAt, "drop comes first");
  assert.ok(revokeAt > createAt, "revoke stays after the create");
  assert.ok(grantAt > revokeAt, "grant stays after the revoke");
  assert.match(body, /returns jsonb/);
  // the reason is written down where the next person will look
  assert.match(body, /42P13/);
  assert.match(body, /cannot change return type/i);
});

test("every statement in the file can be run again", () => {
  const body = sql();

  assert.match(body, /create table if not exists public\.sitemap_refresh_log/);
  for (const column of ["started_at", "refreshed_at", "finished_at", "ok", "mode", "rows", "elapsed_ms", "error"]) {
    assert.match(
      body,
      new RegExp(`alter table public\\.sitemap_refresh_log add column if not exists ${column}\\b`),
      `${column} is added defensively`,
    );
  }
  assert.match(body, /create unique index if not exists sitemap_episodes_ranked_rn_key/);
  assert.match(body, /alter table public\.sitemap_refresh_log enable row level security/);

  // nothing destructive, and no bare CREATE TABLE / CREATE INDEX anywhere
  assert.ok(!/drop table/i.test(body), "the fix never drops the log table");
  assert.ok(!/create table public\./i.test(body));
  assert.ok(!/create unique index sitemap/i.test(body));
});

test("the file says how to run it, and keeps the run order", () => {
  const body = sql();
  const header = body.slice(0, body.indexOf("-- SECTION 0"));

  assert.match(header, /ONE PASTE/);
  assert.match(header, /Supabase SQL editor/i);
  assert.match(header, /SECTION 0/);
  assert.match(header, /SECTION 1 and SECTION 2/);
  assert.match(header, /deploy/i);
  assert.match(header, /SECTION 3/);
  assert.match(header, /SECTION 4/);

  // the sections appear in that order in the file itself
  const order = ["SECTION 0", "SECTION 1", "SECTION 2", "SECTION 3", "SECTION 4"].map((name) =>
    body.indexOf(`-- ${name}`),
  );
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sections are in run order");
});

test("the rollback drops first and restores the old text-returning body", () => {
  const body = rollback();
  const dropAt = body.indexOf("drop function if exists public.refresh_sitemap_episodes();");
  const createAt = body.indexOf("create function public.refresh_sitemap_episodes()");

  assert.ok(dropAt > -1 && createAt > dropAt, "drop then create");
  assert.match(body, /returns text/, "the old signature is restored");
  assert.match(body, /return 'concurrent';/);
  assert.match(body, /return 'full';/);
  assert.match(body, /revoke all on function public\.refresh_sitemap_episodes\(\)/);
  assert.match(body, /grant execute on function public\.refresh_sitemap_episodes\(\)/);
  assert.match(body, /drop table if exists public\.sitemap_refresh_log/);
  assert.ok(
    body.indexOf("drop table if exists public.sitemap_refresh_log") > createAt,
    "the table is dropped only after the function that writes to it is gone",
  );

  // the original body really is the one from sitemap-chunks.sql
  const chunks = read("docs/sql/sitemap-chunks.sql");
  assert.match(chunks, /refresh materialized view concurrently public\.sitemap_episodes_ranked/);
  assert.match(body, /refresh materialized view concurrently public\.sitemap_episodes_ranked/);
});
