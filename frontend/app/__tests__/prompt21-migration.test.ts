// Prompt 21, part 8: the SQL contract. The migration is run by hand, so these
// tests pin the objects the TypeScript relies on: names, uniqueness, the CHECK,
// the RPC grants and the dedupe keys. They are source assertions, not a database.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FRONTEND = join(import.meta.dirname, "..", "..");
const MIGRATION = join(FRONTEND, "supabase", "migrations", "20261101000000_prompt21_push.sql");
const SQL = readFileSync(MIGRATION, "utf8");

test("the migration keeps its exact filename", () => {
  assert.ok(existsSync(MIGRATION), "supabase/migrations/20261101000000_prompt21_push.sql exists");
});

test("push_preferences has the columns the client writes, plus the CHECK", () => {
  for (const column of [
    "enabled",
    "defaults_applied",
    "new_episodes_all",
    "new_episodes_subscribed",
    "replies",
    "likes",
    "mentions",
    "announcements",
    "digest_last_sent_at",
  ]) {
    assert.match(SQL, new RegExp(`\\b${column}\\b`), `${column} is declared`);
  }

  assert.match(SQL, /push_preferences_episode_mode_chk/);
  assert.match(
    SQL,
    /check \(not \(new_episodes_all and new_episodes_subscribed\)\)/i,
    "both episode flags can never be true together",
  );
});

test("the digest cursor belongs to the server", () => {
  assert.match(SQL, /new\.digest_last_sent_at := old\.digest_last_sent_at/);
  assert.match(SQL, /push_preferences_touch_trg/);
});

test("push_allowed maps every kind the code sends", () => {
  assert.match(SQL, /create or replace function public\.push_allowed/);

  for (const kind of ["reply", "like", "mention", "announcement", "episode", "digest"]) {
    assert.match(SQL, new RegExp(`'${kind}'`), `${kind} is handled`);
  }
});

test("push_outbox is service-role only and claims safely", () => {
  assert.match(SQL, /create table if not exists public\.push_outbox/);
  assert.match(SQL, /dedupe_key text not null unique/, "the dedupe key is the unique index");
  assert.match(SQL, /revoke all on public\.push_outbox from anon, authenticated/);
  assert.match(SQL, /create or replace function public\.claim_push_outbox\(p_limit int default 200\)/);
  assert.match(SQL, /for update skip locked/, "overlapping cron runs never claim the same row");
  assert.match(
    SQL,
    /revoke execute on function public\.claim_push_outbox\(int\) from public, anon, authenticated/,
  );
  assert.match(SQL, /grant execute on function public\.claim_push_outbox\(int\) to service_role/);
});

test("user_notifications dedupes one row per user, kind and comment", () => {
  assert.match(
    SQL,
    /create unique index if not exists user_notifications_dedupe_uidx\s+on public\.user_notifications \(user_id, kind, comment_id\)/,
  );
});

test("likes update the existing bell row in place with the running count", () => {
  const likeFunction = SQL.slice(SQL.indexOf("create or replace function public.notify_comment_like"));

  assert.match(likeFunction, /on conflict \(user_id, kind, comment_id\) do update/);
  assert.match(likeFunction, /count = excluded\.count/, "the count is rewritten");
  assert.match(likeFunction, /'Your comment got ' \|\| n \|\| ' likes'/, "the title carries the count");
});

test("the like push collapses to one per comment per hour", () => {
  const likeFunction = SQL.slice(SQL.indexOf("create or replace function public.notify_comment_like"));

  assert.match(
    likeFunction,
    /'like:' \|\| c\.id \|\| ':' \|\| to_char\(now\(\) at time zone 'utc', 'YYYYMMDDHH24'\)/,
    "the dedupe key is the comment id plus the UTC hour, which the cron mirrors",
  );
});

test("reply and mention bell rows are written by their triggers", () => {
  assert.match(SQL, /create or replace function public\.notify_comment_reply/);
  assert.match(SQL, /create trigger comments_notify_reply_trg after insert on public\.comments/);
  assert.match(SQL, /create or replace function public\.notify_comment_mentions/);
  assert.match(SQL, /create trigger comments_notify_mentions_trg after insert on public\.comments/);
  // Mentions skip the parent author, who already gets the reply notification.
  assert.match(SQL, /p\.id is distinct from parent_user/);
  assert.match(SQL, /limit 10/, "at most ten people are mentioned per comment");
});

test("episodes carry playable_at and the trigger that stamps it", () => {
  assert.match(SQL, /alter table public\.episodes add column if not exists playable_at timestamptz/);
  assert.match(SQL, /create or replace function public\.set_episode_playable_at/);
  assert.match(SQL, /create trigger episodes_playable_at_trg/);
});

test("the database itself enqueues subscribed-episode pushes", () => {
  // This is why the cron has no step (2): the trigger already wrote the rows.
  assert.match(SQL, /create or replace function public\.notify_episode_playable/);
  assert.match(
    SQL,
    /create trigger episodes_notify_playable_trg after insert or update of sub_providers, dub_providers on public\.episodes/,
  );
  assert.match(SQL, /pp\.enabled and pp\.new_episodes_subscribed/);
  assert.match(SQL, /'episode:' \|\| new\.anilist_id \|\| ':' \|\| new\.episode_number \|\| ':' \|\| s\.user_id/);
  // Importing the back catalogue must not flood anyone.
  assert.match(SQL, /new\.air_date < current_date - 2/);
  // Adult titles are filtered per user.
  assert.match(SQL, /coalesce\(pr\.show_adult, false\)/);
});

test("announcements are pushed once and read per user", () => {
  assert.match(SQL, /create table if not exists public\.announcements/);
  assert.match(SQL, /push_sent_at timestamptz/);
  assert.match(SQL, /create table if not exists public\.announcement_reads/);
  assert.match(SQL, /primary key \(user_id, announcement_id\)/);
  assert.match(SQL, /announcements read/);
  assert.match(SQL, /announcement reads insert own/);
});

test("the browser may only change read_at on user_notifications", () => {
  assert.match(SQL, /revoke update on public\.user_notifications from anon, authenticated/);
  assert.match(SQL, /grant update \(read_at\) on public\.user_notifications to authenticated/);
});

test("housekeeping is service-role only", () => {
  assert.match(SQL, /create or replace function public\.prune_push_data/);
  assert.match(SQL, /revoke execute on function public\.prune_push_data\(\) from public, anon, authenticated/);
  assert.match(SQL, /grant execute on function public\.prune_push_data\(\) to service_role/);
});

test("the migration is idempotent", () => {
  // Every object is created defensively so re-running it is harmless.
  const creates = SQL.match(/create table (?!if not exists)/gi) ?? [];
  assert.deepEqual(creates, [], "every table uses if not exists");

  const indexCreates = SQL.match(/create index (?!if not exists)/gi) ?? [];
  assert.deepEqual(indexCreates, [], "every index uses if not exists");

  const triggers = SQL.match(/create trigger (?!if not exists)/gi) ?? [];
  assert.ok(triggers.length > 0, "triggers exist");
  // Triggers are guarded with drop trigger if exists just before them.
  const drops = SQL.match(/drop trigger if exists/gi) ?? [];
  assert.ok(drops.length >= triggers.length, "each trigger is dropped first");
});
