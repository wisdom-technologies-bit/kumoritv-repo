// Prompt 35: the SQL the owner runs by hand.
//
// These assertions are about the FILE's contract with docs/sql/clips.sql: the
// columns and checks the API depends on, the idempotent statement forms, and the
// security posture (RLS on, no write policies, service-role-only counter).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const SQL = readFileSync(path.join(process.cwd(), "docs/sql/clips.sql"), "utf8");
const compact = SQL.replace(/\s+/g, " ").toLowerCase();

test("the clips table has every column the API writes", () => {
  for (const column of [
    "id uuid primary key default gen_random_uuid()",
    "code text not null",
    "anilist_id bigint not null references public.anime(anilist_id) on delete cascade",
    "episode_number int not null",
    "start_seconds numeric(8,2) not null",
    "end_seconds numeric(8,2) not null",
    "title text",
    "user_id uuid null references auth.users(id) on delete set null",
    "owner_token_hash text null",
    "source_audio text null",
    "views int not null default 0",
    "created_at timestamptz default now()",
    "deleted_at timestamptz null",
  ]) {
    assert.ok(compact.includes(column), `missing column: ${column}`);
  }
});

test("the range checks are in the database, not only in TypeScript", () => {
  assert.match(compact, /check \(end_seconds > start_seconds\)/);
  assert.match(compact, /check \(end_seconds - start_seconds <= 120\)/);
  assert.match(compact, /check \(start_seconds >= 0\)/);
});

test("the indexes the routes need exist", () => {
  assert.match(compact, /create unique index if not exists clips_code_key on public\.clips \(code\)/);
  assert.match(
    compact,
    /create index if not exists clips_user_created_idx on public\.clips \(user_id, created_at desc\)/,
  );
  assert.match(
    compact,
    /create index if not exists clips_anime_episode_idx on public\.clips \(anilist_id, episode_number\)/,
  );
});

test("every statement is idempotent", () => {
  assert.match(compact, /create table if not exists public\.clips/);
  assert.match(compact, /create table if not exists public\.clip_reports/);
  assert.match(compact, /create extension if not exists pgcrypto/);
  assert.match(compact, /create or replace function public\.increment_clip_views/);
  assert.match(compact, /drop policy if exists clips_select_own/);
  // No bare CREATE TABLE / CREATE INDEX that would fail on a second run.
  assert.equal(/create table (?!if not exists)/.test(compact), false);
  assert.equal(/create (unique )?index (?!if not exists)/.test(compact), false);
});

test("RLS is on, writes are refused, and reads are limited to the owner", () => {
  assert.match(compact, /alter table public\.clips enable row level security/);
  assert.match(compact, /alter table public\.clip_reports enable row level security/);
  assert.match(compact, /create policy clips_select_own on public\.clips for select to authenticated using \(auth\.uid\(\) = user_id\)/);
  // There must be no insert/update/delete policy anywhere in the file.
  for (const command of ["for insert", "for update", "for delete", "for all"]) {
    assert.equal(compact.includes(command), false, `unexpected write policy: ${command}`);
  }
});

test("the view counter is service-role only", () => {
  assert.match(compact, /create or replace function public\.increment_clip_views\(p_code text\)/);
  assert.match(compact, /grant execute on function public\.increment_clip_views\(text\) to service_role/);
  assert.match(compact, /revoke all on function public\.increment_clip_views\(text\) from anon/);
  assert.match(compact, /revoke all on function public\.increment_clip_views\(text\) from authenticated/);
});

test("the file explains the choices it makes", () => {
  assert.match(SQL, /RLS AND ACCESS/);
  assert.match(SQL, /ADMIN DELETE/);
  assert.match(compact, /service role/);
});
