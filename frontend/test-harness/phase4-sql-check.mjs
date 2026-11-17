// Phase 4, part C: the SQL file, run for real.
//
// PGlite is Postgres compiled to WASM, so this is not a string comparison: the
// file is executed as ONE paste, twice (idempotency), then `community_latest`
// is called against fixtures and the answers are checked. The shims below are
// the only things Supabase would otherwise supply (auth.uid(), staff_roles,
// is_admin(), the browser roles).
//
// Plain Node ESM on purpose: PGlite loads its WASM bundle from a file URL, which
// the test harness's CommonJS transform cannot provide. app/lib/community/
// __tests__/phase4-sql.test.ts spawns this script so it still runs in `npm test`.
//
//   node test-harness/phase4-sql-check.mjs
//
// What this does NOT prove: Supabase's RLS enforcement (PGlite runs as the owner
// here, so policies are created but never evaluated) and the real project's data.
//
// Exits 0 when every check passes, 1 with the first failure otherwise.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PHASE_SQL = readFileSync(path.join(ROOT, "docs/sql/community-phase-4.sql"), "utf8");
const ROLLBACK_SQL = readFileSync(path.join(ROOT, "docs/sql/community-phase-4.rollback.sql"), "utf8");

const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const ADA = "00000000-0000-4000-8000-0000000000a1";
const GONE = "00000000-0000-4000-8000-0000000000a2";

const SHIMS = `
create role anon;
create role authenticated;
create schema if not exists auth;

create table auth.users (id uuid primary key);

create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.staff_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin'
);

create function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_roles where user_id = auth.uid());
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  display_name text,
  avatar_url text,
  show_adult boolean not null default false
);

create view public.public_profiles as
  select id, username, display_name, avatar_url from public.profiles;

create table public.anime (
  anilist_id bigint primary key,
  title text,
  title_english text,
  cover_url text,
  is_adult boolean not null default false
);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  anilist_id bigint not null references public.anime (anilist_id) on delete cascade,
  episode_number int not null,
  start_seconds numeric(8,2) not null,
  end_seconds numeric(8,2) not null,
  title text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users (id) on delete set null,
  body text,
  is_spoiler boolean not null default false,
  clip_id uuid references public.clips (id) on delete set null,
  link_url text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  status text not null default 'published' check (status in ('published','hidden','removed'))
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  image text,
  url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  push_sent_at timestamptz
);
`;

async function mainRun() {
  const db = new PGlite();
  await db.exec(SHIMS);

  // ---- the file, as one paste -------------------------------------------------
  await db.exec(PHASE_SQL);
  await db.exec(PHASE_SQL); // idempotent: a second run must not fail

  // ---- what it added ---------------------------------------------------------
  const columns = await db.query(
    `select table_name, column_name, is_nullable
       from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'profiles' and column_name = 'community_toasts')
          or (table_name = 'announcements' and column_name in ('created_by','idempotency_key','updated_at')))
      order by table_name, column_name`,
  );
  assert.deepEqual(
    columns.rows.map((row) => `${row.table_name}.${row.column_name}`),
    [
      "announcements.created_by",
      "announcements.idempotency_key",
      "announcements.updated_at",
      "profiles.community_toasts",
    ],
  );
  assert.equal(
    columns.rows.find((row) => row.column_name === "community_toasts")?.is_nullable,
    "NO",
    "the switch is not nullable",
  );

  const indexes = await db.query(
    `select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'announcements'
        and indexname in ('announcements_idempotency_key_idx','announcements_created_at_idx')
      order by indexname`,
  );
  assert.equal(indexes.rows.length, 2);

  const policies = await db.query(
    `select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'announcements'
      order by policyname`,
  );
  assert.deepEqual(
    policies.rows.map((row) => row.policyname),
    ["announcements delete admin", "announcements insert admin", "announcements read", "announcements update admin"],
  );

  // The unique index has to lose the race, not the application.
  await db.exec(`insert into public.announcements (title, body, idempotency_key)
                 values ('first', 'body', '11111111-1111-4111-8111-111111111111')`);
  await assert.rejects(
    db.exec(`insert into public.announcements (title, body, idempotency_key)
             values ('second', 'body', '11111111-1111-4111-8111-111111111111')`),
    /duplicate key|unique/i,
  );
  await db.exec(`delete from public.announcements`);

  // ---- fixtures --------------------------------------------------------------
  await db.exec(`
    insert into auth.users (id) values ('${ADA}'), ('${GONE}'), ('${ADMIN}');
    insert into public.staff_roles (user_id) values ('${ADMIN}');

    insert into public.profiles (id, username, display_name, avatar_url) values
      ('${ADA}', 'ada', 'Ada', 'https://cdn.test/ada.png');
    -- '${GONE}' has no profile row: a deleted account.

    insert into public.anime (anilist_id, title, cover_url, is_adult) values
      (1, 'Safe Show', 'https://cdn.test/safe.jpg', false),
      (2, 'Adult Show', 'https://cdn.test/adult.jpg', true);

    insert into public.clips (id, code, anilist_id, episode_number, start_seconds, end_seconds) values
      ('20000000-0000-4000-8000-000000000001', 'safeclip', 1, 3, 10, 40),
      ('20000000-0000-4000-8000-000000000002', 'adultclip', 2, 1, 5, 25);

    insert into public.community_posts (id, author_id, body, is_spoiler, clip_id, created_at, status) values
      ('10000000-0000-4000-8000-000000000001', '${ADA}',  '**hello** world', false, null, '2026-11-17T10:00:00Z', 'published'),
      ('10000000-0000-4000-8000-000000000002', '${ADA}',  'spoiler body',    true,  null, '2026-11-17T10:01:00Z', 'published'),
      ('10000000-0000-4000-8000-000000000003', '${GONE}', 'from a deleted account', false, null, '2026-11-17T10:02:00Z', 'published'),
      ('10000000-0000-4000-8000-000000000004', '${ADA}',  'clip post',       false, '20000000-0000-4000-8000-000000000001', '2026-11-17T10:03:00Z', 'published'),
      ('10000000-0000-4000-8000-000000000005', '${ADA}',  'adult clip post', false, '20000000-0000-4000-8000-000000000002', '2026-11-17T10:04:00Z', 'published'),
      ('10000000-0000-4000-8000-000000000006', '${ADA}',  'hidden post',     false, null, '2026-11-17T10:05:00Z', 'hidden'),
      ('10000000-0000-4000-8000-000000000007', '${ADA}',  'removed post',    false, null, '2026-11-17T10:06:00Z', 'removed');

    update public.community_posts set deleted_at = now() where id = '10000000-0000-4000-8000-0000000000ff';

    insert into public.announcements (id, title, body, created_at, expires_at) values
      ('30000000-0000-4000-8000-000000000001', 'We are back', '**We''re back.** Happy watching!', '2026-11-17T10:07:00Z', null),
      ('30000000-0000-4000-8000-000000000002', 'Expired', 'gone', '2026-11-17T10:08:00Z', '2020-01-01T00:00:00Z');
  `);

  // ---- the function ----------------------------------------------------------
  const rows = await db.query(`select * from public.community_latest('2026-11-17T09:59:00Z', 5)`);

  const ids = rows.rows.map((row) => row.id);
  assert.deepEqual(
    ids,
    [
      "30000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000005",
      "10000000-0000-4000-8000-000000000004",
      "10000000-0000-4000-8000-000000000003",
      "10000000-0000-4000-8000-000000000002",
    ],
    "newest first, capped at the limit, hidden/removed/expired absent",
  );
  assert.equal(ids.includes("10000000-0000-4000-8000-000000000006"), false, "hidden never leaks");
  assert.equal(ids.includes("10000000-0000-4000-8000-000000000007"), false, "removed never leaks");
  assert.equal(ids.includes("30000000-0000-4000-8000-000000000002"), false, "expired announcements never leak");

  const spoiler = rows.rows.find((row) => row.id === "10000000-0000-4000-8000-000000000002");
  assert.equal(spoiler?.text, "Spoiler");

  const deletedAuthor = rows.rows.find((row) => row.id === "10000000-0000-4000-8000-000000000003");
  assert.equal(deletedAuthor?.author_name, "[deleted]");

  const adult = rows.rows.find((row) => row.id === "10000000-0000-4000-8000-000000000005");
  assert.equal(adult?.adult, true);
  assert.equal(adult?.clip_thumb, null, "the adult thumbnail is nulled in SQL, not only in the route");

  const clip = rows.rows.find((row) => row.id === "10000000-0000-4000-8000-000000000004");
  assert.equal(clip?.has_clip, true);
  assert.equal(clip?.clip_thumb, "https://cdn.test/safe.jpg");

  const announcement = rows.rows.find((row) => row.kind === "announcement");
  assert.equal(announcement?.href, "/community/announcements/30000000-0000-4000-8000-000000000001");

  // The cursor is exclusive and there is nothing before the oldest item.
  const older = await db.query(
    `select id from public.community_latest('2026-11-17T10:03:00Z', 10)`,
  );
  assert.deepEqual(
    older.rows.map((row) => row.id),
    ["30000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000005"],
  );

  const none = await db.query(`select id from public.community_latest(null, 5)`);
  assert.equal(none.rows.length, 0, "no cursor means no backlog");

  await db.close();
}

async function rollbackRun() {
  const db = new PGlite();
  await db.exec(SHIMS);
  await db.exec(PHASE_SQL);
  await db.exec(ROLLBACK_SQL);
  await db.exec(ROLLBACK_SQL); // idempotent too

  const columns = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'profiles' and column_name = 'community_toasts')
          or (table_name = 'announcements' and column_name in ('created_by','idempotency_key','updated_at')))`,
  );
  assert.equal(columns.rows.length, 0);

  const fn = await db.query(
    `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'community_latest'`,
  );
  assert.equal(fn.rows.length, 0);

  // The announcement policies survive the rollback, as community.sql defines them.
  const policies = await db.query(
    `select policyname from pg_policies where schemaname = 'public' and tablename = 'announcements'`,
  );
  assert.equal(policies.rows.length, 4);

  await db.close();
}

try {
  await mainRun();
  await rollbackRun();
  console.log("phase4 sql: all checks passed");
  process.exit(0);
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
