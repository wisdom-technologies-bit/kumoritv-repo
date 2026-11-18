// Phase 6, part A/F: the Phase 6 SQL, run for real.
//
// PGlite is Postgres compiled to WASM, so this executes the actual files - the
// whole community chain in its documented order, then community-phase-6.sql
// twice (idempotency) - and then moderates real rows as different users.
//
// The only things Supabase would otherwise supply are shimmed below: the browser
// roles, auth.users, auth.uid() (read from a session GUC this script sets), the
// base clips/anime/profiles tables, and the two notification tables the
// moderation function cleans up.
//
// WHAT THIS PROVES
//   * community_moderate() refuses a non-staff caller and accepts a moderator;
//   * one log row per real change, none for a no-op (idempotent);
//   * remove needs a reason; hide does not;
//   * hiding/removing resolves the target's open reports;
//   * community_feed_page hides the row from a normal viewer, shows it to its
//     author and to staff, and reports status + moderation_reason;
//   * comment_feed masks a moderated comment for everyone else, keeps a thread
//     placeholder only when replies exist, and shows the author their own body;
//   * a hidden clip is 'removed' in the feed;
//   * the bell rows and undelivered push rows for moderated comments are gone;
//   * the rollback file restores the Phase 5 shapes.
//
// WHAT THIS DOES NOT PROVE
//   * Supabase's RLS enforcement itself (PGlite runs as the owner, so policies
//     are created but never evaluated) - the policies are only checked for
//     existence and expression text;
//   * the real project's data, extensions or dashboard settings.
//
//   node test-harness/phase6-sql-check.mjs
//
// Exits 0 when every check passes, 1 with the first failure.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SQL = (name) => readFileSync(path.join(ROOT, "docs/sql", name), "utf8");

// Supabase supplies its extensions; PGlite has gen_random_uuid() built in and
// no pgcrypto bundle, so the `create extension` lines are skipped. Nothing else
// in the files is altered.
const strip = (text) => text.replace(/create extension[^;]*;/gi, "");

const PHASE6 = strip(SQL("community-phase-6.sql"));
const PHASE6_ROLLBACK = strip(SQL("community-phase-6.rollback.sql"));

const CHAIN = [
  "community.sql",
  "community-patch-1.sql",
  "comments-deleted-users.sql",
  "community-comments-arm.sql",
  "community-clips-arm.sql",
];

const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const MOD = "00000000-0000-4000-8000-0000000000ab";
const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const VIEWER = "00000000-0000-4000-8000-0000000000a2";
const REPORTER = "00000000-0000-4000-8000-0000000000a3";

const POST = "11111111-1111-4111-8111-111111111111";
const COMMENT_WITH_REPLY = "22222222-2222-4222-8222-222222222222";
const COMMENT_NO_REPLY = "33333333-3333-4333-8333-333333333333";
const REPLY = "44444444-4444-4444-8444-444444444444";
const ANNOUNCEMENT = "55555555-5555-4555-8555-555555555555";
const CLIP = "66666666-6666-4666-8666-666666666666";

const SHIMS = `
create role anon;
create role authenticated;
create role service_role;
create schema if not exists auth;

create table auth.users (id uuid primary key);

create function auth.uid() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;

create table public.staff_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('moderator','admin'))
);

-- The base comment tables predate the community feature (supabase/migrations/
-- 20261023000000_core.sql). The shim reproduces their columns; community.sql
-- then adds target_type / post_id / announcement_id to them.
-- auth.jwt() is Supabase's; the shim returns the same empty claims object a
-- request without an anonymous flag would carry.
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  anilist_id bigint not null,
  episode_number int,
  user_id uuid references auth.users (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null,
  is_spoiler boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.comment_reactions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  value smallint not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

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
  user_id uuid references auth.users (id) on delete set null,
  owner_token_hash text,
  source_audio text,
  views int not null default 0,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  image text,
  url text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  push_sent_at timestamptz
);

-- Prompt 35's clip reports (docs/sql/clips.sql creates it for real).
create table public.clip_reports (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  reason text not null check (reason in ('copyright','broken','inappropriate','spam','other')),
  details text,
  reporter_hash text,
  created_at timestamptz not null default now()
);

-- The bell and the push queue: the moderation function deletes rows here.
create table public.user_notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  comment_id uuid,
  kind text not null default 'reply',
  payload jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_sent_at timestamptz
);
create table public.push_outbox (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  url text,
  image text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text
);
`;

async function as(db, uid) {
  await db.exec(`select set_config('app.uid', ${uid ? `'${uid}'` : "''"}, false);`);
}

async function main() {
  const db = new PGlite();
  await db.exec(SHIMS);

  for (const file of CHAIN) {
    await db.exec(strip(SQL(file)));
  }
  await db.exec(`alter table public.user_notifications
    add constraint user_notifications_comment_fk
    foreign key (comment_id) references public.comments (id) on delete cascade;`);

  // ---- the Phase 6 file: twice, in one paste, no failure --------------------
  await db.exec(PHASE6);
  await db.exec(PHASE6);

  // ---- fixtures ------------------------------------------------------------
  // The insert guards (10 s between comments, daily caps) are for real users;
  // fixtures are written with triggers off, then turned back on.
  await db.exec(`alter table public.comments disable trigger user;
    alter table public.community_posts disable trigger user;`);
  await db.exec(`
    insert into auth.users (id) values
      ('${ADMIN}'), ('${MOD}'), ('${AUTHOR}'), ('${VIEWER}'), ('${REPORTER}');
    insert into public.staff_roles (user_id, role) values
      ('${ADMIN}', 'admin'), ('${MOD}', 'moderator');
    insert into public.profiles (id, username, display_name) values
      ('${ADMIN}', 'ada', 'Ada'), ('${MOD}', 'mo', 'Mo'),
      ('${AUTHOR}', 'author', 'Author'), ('${VIEWER}', 'viewer', 'Viewer'),
      ('${REPORTER}', 'reporter', 'Reporter');
    insert into public.anime (anilist_id, title, title_english, cover_url) values
      (101, 'Test Anime', 'Test Anime', 'https://example.test/c.jpg');
    insert into public.clips (id, code, anilist_id, episode_number, start_seconds, end_seconds, title)
      values ('${CLIP}', 'abc2345', 101, 1, 0, 30, 'Clip title');
    insert into public.community_posts (id, author_id, body) values
      ('${POST}', '${AUTHOR}', 'A post that will be moderated');
    insert into public.announcements (id, title, body, created_by) values
      ('${ANNOUNCEMENT}', 'Hello', 'An announcement', '${ADMIN}');
    insert into public.comments (id, anilist_id, episode_number, parent_id, user_id, body, target_type)
      values
        ('${COMMENT_WITH_REPLY}', 101, 1, null, '${AUTHOR}', 'Parent comment', 'anime'),
        ('${REPLY}', 101, 1, '${COMMENT_WITH_REPLY}', '${VIEWER}', 'A reply', 'anime'),
        ('${COMMENT_NO_REPLY}', 101, 2, null, '${AUTHOR}', 'Lonely comment', 'anime');
    insert into public.community_reports (reporter_id, target_kind, target_id, reason)
      values ('${REPORTER}', 'post', '${POST}', 'spam');
  `);
  await db.exec(`alter table public.comments enable trigger user;
    alter table public.community_posts enable trigger user;`);

  const count = async (table, where = "true") =>
    Number((await db.query(`select count(*)::int as n from ${table} where ${where}`)).rows[0].n);

  // ---- 1. a non-staff caller is refused by the function itself -------------
  await as(db, VIEWER);
  await assert.rejects(
    () => db.query(`select public.community_moderate('post', '${POST}', 'hide', null)`),
    /not_staff/,
  );
  assert.equal(await count("public.community_moderation_log"), 0, "no log row for a refused actor");
  console.log("ok  community_moderate refuses a non-staff caller");

  // ---- 2. a moderator hides: one row, one log, reports answered ------------
  await as(db, MOD);
  const hide = await db.query(
    `select public.community_moderate('post', '${POST}', 'hide', null) as result`,
  );
  const hideResult = hide.rows[0].result;
  assert.equal(hideResult.changed, true);
  assert.equal(hideResult.status, "hidden");
  assert.equal(hideResult.reports_actioned, 1);
  assert.equal(await count("public.community_moderation_log"), 1);
  assert.equal(await count("public.community_posts", `id = '${POST}' and status = 'hidden'`), 1);
  assert.equal(await count("public.community_reports", `status = 'actioned' and resolved_by is not null`), 1);
  console.log("ok  hide: status, exactly one log row, open report actioned");

  // ---- 3. idempotent: acting twice on the same state logs nothing ----------
  const again = await db.query(`select public.community_moderate('post', '${POST}', 'hide', null) as result`);
  assert.equal(again.rows[0].result.changed, false);
  assert.equal(await count("public.community_moderation_log"), 1, "a no-op writes no log row");
  console.log("ok  hide twice: changed=false, log still one row");

  // ---- 4. remove needs a reason, and writes it -----------------------------
  await assert.rejects(
    () => db.query(`select public.community_moderate('post', '${POST}', 'remove', 'x')`),
    /reason_required/,
  );
  await db.query(`select public.community_moderate('post', '${POST}', 'remove', 'Harassment, third time')`);
  assert.equal(await count("public.community_moderation_log"), 2);
  assert.equal(
    await count("public.community_posts", `id = '${POST}' and removed_reason = 'Harassment, third time'`),
    1,
  );
  console.log("ok  remove requires a 3+ character reason and stores it");

  // ---- 5. the feed, as three different viewers -----------------------------
  const feed = async (uid) => {
    await as(db, uid);
    return (
      await db.query(
        `select feed_key, kind, status, moderation_reason from public.community_feed_page(50, null, null, 'all', false, null, null, true)`,
      )
    ).rows;
  };

  const viewerFeed = await feed(VIEWER);
  assert.equal(viewerFeed.filter((row) => row.feed_key === `post:${POST}`).length, 0, "removed post is absent for a viewer");

  const authorFeed = await feed(AUTHOR);
  const authorPost = authorFeed.find((row) => row.feed_key === `post:${POST}`);
  assert.ok(authorPost, "the author still sees their own removed post");
  assert.equal(authorPost.status, "removed");
  assert.equal(authorPost.moderation_reason, "Harassment, third time");

  const staffFeed = await feed(MOD);
  assert.ok(staffFeed.find((row) => row.feed_key === `post:${POST}`), "staff see it in place");
  console.log("ok  feed: absent for a viewer, present with status for the author and staff");

  // ---- 6. announcements ----------------------------------------------------
  await as(db, MOD);
  await db.query(`select public.community_moderate('announcement', '${ANNOUNCEMENT}', 'hide', null)`);
  const viewerAnnouncements = (await feed(VIEWER)).filter((row) => row.kind === "announcement");
  assert.equal(viewerAnnouncements.length, 0, "a hidden announcement leaves the feed");
  const staffAnnouncements = (await feed(MOD)).filter((row) => row.kind === "announcement");
  assert.equal(staffAnnouncements.length, 1);
  console.log("ok  announcement: hidden from the feed, visible to staff");

  // ---- 7. comments: placeholder only when replies exist -------------------
  await as(db, MOD);
  await db.query(`select public.community_moderate('comment', '${COMMENT_WITH_REPLY}', 'remove', 'Spam')`);
  await db.query(`select public.community_moderate('comment', '${COMMENT_NO_REPLY}', 'remove', 'Spam')`);

  const comments = async (uid) => {
    await as(db, uid);
    return (await db.query(`select id, body, moderation_status, moderation_reason from public.comment_feed`)).rows;
  };

  const viewerComments = await comments(VIEWER);
  const placeholder = viewerComments.find((row) => row.id === COMMENT_WITH_REPLY);
  assert.ok(placeholder, "a removed comment with replies keeps its row");
  assert.equal(placeholder.body, null, "and its body is masked in SQL");
  assert.equal(placeholder.moderation_status, "removed");
  assert.equal(placeholder.moderation_reason, null, "the reason is not public");
  assert.equal(
    viewerComments.find((row) => row.id === COMMENT_NO_REPLY),
    undefined,
    "a removed comment with no replies disappears",
  );

  const authorComments = await comments(AUTHOR);
  const own = authorComments.find((row) => row.id === COMMENT_NO_REPLY);
  assert.ok(own, "the author still sees their own removed comment");
  assert.equal(own.body, "Lonely comment");
  assert.equal(own.moderation_reason, "Spam");
  console.log("ok  comment_feed: placeholder with replies, gone without, author keeps their body");

  // ---- 8. a hidden clip is gone from the feed -----------------------------
  await as(db, MOD);
  await db.query(`select public.community_moderate('clip', '${CLIP}', 'hide', null)`);
  const clipFeed = (
    await db.query(`select feed_key, clip_state from public.community_feed_page(50, null, null, 'clips', false, null, null, true)`)
  ).rows;
  const clipRow = clipFeed.find((row) => row.feed_key === `post:${POST}`);
  if (clipRow) assert.notEqual(clipRow.clip_state, "live", "a hidden clip is never live");
  await db.query(`select public.community_moderate('clip', '${CLIP}', 'unhide', null)`);
  assert.equal(await count("public.clips", `id = '${CLIP}' and hidden_at is null`), 1);
  console.log("ok  clip: hide/restore round-trips through hidden_at");

  // ---- 9. the bell and the push queue lose moderated content --------------
  await db.exec(`
    insert into public.user_notifications (user_id, comment_id, kind)
      values ('${VIEWER}', '${COMMENT_WITH_REPLY}', 'reply');
    insert into public.push_outbox (user_id, type, title, dedupe_key)
      values ('${VIEWER}', 'reply', 'A reply', 'reply:${COMMENT_WITH_REPLY}');
  `);
  await as(db, MOD);
  await db.query(`select public.community_moderate('comment', '${COMMENT_WITH_REPLY}', 'restore', null)`);
  await db.query(`select public.community_moderate('comment', '${COMMENT_NO_REPLY}', 'restore', null)`);
  await db.query(`select public.community_moderate('comment', '${COMMENT_WITH_REPLY}', 'remove', 'Spam again')`);
  assert.equal(
    await count("public.user_notifications", `comment_id = '${COMMENT_WITH_REPLY}'`),
    0,
    "the bell row for a removed comment is gone",
  );
  assert.equal(
    await count("public.push_outbox", `dedupe_key = 'reply:${COMMENT_WITH_REPLY}'`),
    0,
    "the undelivered push for it is gone",
  );
  console.log("ok  bell + push: notifications for moderated content are removed");

  // ---- 10. a moderator is not an admin, but both are staff ---------------
  await as(db, MOD);
  assert.equal((await db.query(`select public.is_staff() as s, public.is_admin() as a`)).rows[0].s, true);
  assert.equal((await db.query(`select public.is_admin() as a`)).rows[0].a, false);
  await as(db, ADMIN);
  assert.equal((await db.query(`select public.is_admin() as a`)).rows[0].a, true);
  console.log("ok  roles: moderator is staff but not admin");

  // ---- 10b. the report inbox (part B) ------------------------------------
  await db.exec(`
    insert into public.community_reports (reporter_id, target_kind, target_id, reason) values
      ('${REPORTER}', 'announcement', '${ANNOUNCEMENT}', 'spam'),
      ('${VIEWER}', 'announcement', '${ANNOUNCEMENT}', 'inappropriate');
  `);

  await as(db, VIEWER);
  await assert.rejects(() => db.query(`select * from public.community_report_groups()`), /not_staff/);
  await as(db, ADMIN);

  const groups = (
    await db.query(`select * from public.community_report_groups('open', null, null, 25, null, null, null)`)
  ).rows;
  assert.equal(groups.length, 1, "one row per content item, not per report");
  assert.equal(Number(groups[0].report_count), 2);
  assert.equal(Number(groups[0].reporter_count), 2, "two distinct reporters");
  assert.equal(groups[0].target_status, "hidden");
  assert.equal(groups[0].is_gone, false);

  const page2 = (
    await db.query(
      `select * from public.community_report_groups('open', null, null, 25, ${Number(groups[0].report_count)}, '${groups[0].latest_report_at.toISOString()}', '${ANNOUNCEMENT}')`,
    )
  ).rows;
  assert.equal(page2.length, 0, "the keyset cursor does not repeat the group");
  console.log("ok  report groups: grouped, counted, keyset paginated");

  // clip reports: the same decision, through community_moderate
  await db.exec(`insert into public.clip_reports (clip_id, reason) values ('${CLIP}', 'copyright');`);
  await db.query(`select public.community_moderate('clip', '${CLIP}', 'remove', 'Copyright claim')`);
  assert.equal(
    await count("public.clip_reports", `clip_id = '${CLIP}' and status = 'actioned' and resolved_by is not null`),
    1,
    "removing the clip answers its clip reports",
  );
  const clipGroups = (
    await db.query(`select * from public.community_clip_report_groups(null, 25, null, null, null)`)
  ).rows;
  assert.equal(Number(clipGroups[0].report_count), 1);
  assert.equal(clipGroups[0].clip_state, "removed");
  console.log("ok  clip reports: grouped and actioned by the same function");

  const stats = (await db.query(`select * from public.community_moderation_stats()`)).rows[0];
  assert.ok(Number(stats.actions_7d) > 0, "the dashboard sees the actions");
  assert.equal(Number(stats.removed_items) > 0, true);
  console.log("ok  stats: counters answer for staff");

  // ---- 11. the log survives the actor leaving ----------------------------
  const moderatorRows = await count("public.community_moderation_log", `actor_id = '${MOD}'`);
  await db.exec(`delete from auth.users where id = '${MOD}';`);
  const totalLogRows = await count("public.community_moderation_log");
  assert.ok(totalLogRows > 3, "there are several moderator actions by now");
  assert.equal(
    await count("public.community_moderation_log", `actor_id = '${MOD}'`),
    0,
    "no log row still points at the deleted moderator",
  );
  assert.ok(moderatorRows > 0, "the moderator logged several actions");
  assert.equal(
    await count("public.community_moderation_log", `actor_id is null`),
    moderatorRows,
    "every action the moderator took now reads actor_id null and the rows survive",
  );
  assert.ok(totalLogRows >= moderatorRows);
  console.log("ok  log: a deleted moderator's actions survive with actor_id null");

  // ---- 12. the rollback restores Phase 5 --------------------------------
  // It refuses while moderated rows exist - which is the point.
  await assert.rejects(() => db.exec(PHASE6_ROLLBACK), /Refusing to roll back/);
  // The file opens its own transaction; a raised guard leaves that transaction
  // aborted, so clear it before continuing.
  try {
    await db.exec("rollback;");
  } catch {}
  console.log("ok  rollback: refuses to drop moderation state silently");

  // Restore everything, then roll back for real.
  await as(db, ADMIN);
  await db.query(`select public.community_moderate('post', '${POST}', 'restore', null)`);
  await db.query(`select public.community_moderate('comment', '${COMMENT_WITH_REPLY}', 'restore', null)`);
  await db.query(`select public.community_moderate('comment', '${COMMENT_NO_REPLY}', 'restore', null)`);
  await db.query(`select public.community_moderate('announcement', '${ANNOUNCEMENT}', 'unhide', null)`);
  await db.query(`select public.community_moderate('clip', '${CLIP}', 'restore', null)`);
  await db.exec(PHASE6_ROLLBACK);
  const afterRollback = await db.query(
    `select column_name from information_schema.columns
      where table_name = 'comments' and column_name = 'status'`,
  );
  assert.equal(afterRollback.rows.length, 0, "the moderation columns are gone");
  const fn = await db.query(
    `select proname from pg_proc where proname = 'community_moderate'`,
  );
  assert.equal(fn.rows.length, 0, "community_moderate is dropped");
  console.log("ok  rollback: restores the Phase 5 schema");

  // And the forward file runs again afterwards (idempotency across a rollback).
  await db.exec(PHASE6);
  console.log("ok  re-running community-phase-6.sql after a rollback succeeds");

  console.log("\nall checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
