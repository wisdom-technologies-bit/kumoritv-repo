// Prompt 18 / Part 3: the pipeline that never fed itself.
//
// Production facts this covers: nothing called enqueueAnime, nothing wrote
// pending_sync, so the sync and import-queue jobs had nothing to process and
// `episodes`/`anime` only grew when a visitor opened a page. And the import-queue
// job re-claimed the same failing row in a hot loop (6081 claims against 5 rows)
// because a status outside the table's CHECK made every `.update` fail silently.

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { FakeSupabaseClient } from "../../test-harness/fake-supabase";
import { queuePendingSync } from "@/app/lib/discovery/store";
import { enqueueMissingAnime, ENQUEUE_CHUNK_SIZE, ENQUEUE_MAX_PER_RUN } from "@/app/lib/anime-db/queue";
import {
  CIRCUIT_FAILURE_LIMIT,
  MAX_IMPORTS_PER_RUN,
  VALID_QUEUE_STATUSES,
  decideQueueState,
  normalizeQueueStatus,
  runImportQueue,
} from "@/app/lib/anime-db/import-queue";
import type { ImportResult } from "@/app/lib/anime-db/import";
import { isSystemicFailure } from "@/app/lib/anime-db/import";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

/** FakeSupabaseClient + an `enqueue_anime` RPC, which the fake does not model. */
function queueDb(seed: Record<string, any[]> = {}) {
  const db = new FakeSupabaseClient(seed) as any;
  const calls: Array<{ items: any[]; reason: string; priority: number }> = [];

  db.rpc = async (name: string, args: any) => {
    if (name !== "enqueue_anime") return { data: null, error: new Error(`unexpected rpc ${name}`) };
    calls.push({ items: args.items ?? [], reason: args.p_reason, priority: args.p_priority });
    for (const item of args.items ?? []) {
      db.tables.anime_import_queue ??= [];
      db.tables.anime_import_queue.push({ ...item, status: "pending" });
    }
    return { data: (args.items ?? []).length, error: null };
  };

  return { db, calls };
}

const media = (id: number, extra: Record<string, any> = {}) => ({
  id,
  isAdult: false,
  popularity: 100,
  title: { romaji: `Anime ${id}`, english: null },
  coverImage: { large: null },
  format: "TV",
  ...extra,
});

// ------------------------------------------------------- airing -> pending_sync

test("the airing job queues one pending_sync row per newly seen episode, adults skipped", async () => {
  const db = new FakeSupabaseClient({
    pending_sync: [{ anilist_id: 5, episode_number: 1 }],
  }) as any;

  const queued = await queuePendingSync(
    db,
    [
      { anilist_id: 1, episode: 2 },
      { anilist_id: 1, episode: 3 },
      { anilist_id: 2, episode: 1 },
      // A repeated sighting inside the same run: written once.
      { anilist_id: 1, episode: 2 },
      // The adult title that is in the same batch: skipped by id.
      { anilist_id: 99, episode: 4 },
      // Junk that must never reach the unique index.
      { anilist_id: 0, episode: 1 },
      { anilist_id: 3, episode: 0 },
    ],
    { skipAnilistIds: new Set([99]), chunkSize: 500 },
  );

  const rows = db.rows("pending_sync");
  const keys = rows.map((row: any) => `${row.anilist_id}-${row.episode_number}`);

  assert.equal(new Set(keys).size, keys.length, "no duplicate (anilist_id, episode_number)");
  assert.ok(keys.includes("1-2"), "the first new episode is queued");
  assert.ok(keys.includes("1-3"), "the second new episode is queued");
  assert.ok(keys.includes("2-1"), "the other show is queued");
  assert.equal(keys.some((key: string) => key.startsWith("99-")), false, "adult titles are skipped");
  assert.equal(keys.some((key: string) => key.startsWith("0-") || key.endsWith("-0")), false, "invalid rows are dropped");
  assert.ok(queued >= 3, "the queued count is reported");
});

test("queued episodes are written in chunks of 500", async () => {
  const db = new FakeSupabaseClient({ pending_sync: [] }) as any;
  const chunks: number[] = [];
  const original = db.from.bind(db);
  db.from = (table: string) => {
    const query = original(table);
    const upsert = query.upsert.bind(query);
    query.upsert = (rows: any[], options: any) => {
      chunks.push(Array.isArray(rows) ? rows.length : 1);
      return upsert(rows, options);
    };
    return query;
  };

  const rows = Array.from({ length: 1201 }, (_, index) => ({ anilist_id: 1000 + index, episode: 1 }));
  await queuePendingSync(db, rows);

  assert.deepEqual(chunks, [500, 500, 201], "chunks of 500");
  assert.equal(db.rows("pending_sync").length, 1201);
});

// ------------------------------------------------------- discover -> enqueueAnime

test("discover enqueues only missing, non-adult anime, most popular first", async () => {
  const { db, calls } = queueDb({
    anime: [{ anilist_id: 2 }],
  });

  const enqueued = await enqueueMissingAnime(
    [
      media(2, { popularity: 900 }), // already imported
      media(3, { popularity: 10 }),
      media(4, { popularity: 800 }),
      media(5, { popularity: 5000, isAdult: true }), // adult
      media(4, { popularity: 800 }), // duplicate sighting
      media(6, { popularity: 50 }),
    ],
    "discover",
    5,
    { db, max: 200 },
  );

  const ids = calls.flatMap((call) => call.items.map((item: any) => item.anilist_id));

  assert.deepEqual(ids, [4, 6, 3], "most popular first, no adult, no existing row, no duplicates");
  assert.equal(enqueued, 3);
  assert.equal(calls[0]!.reason, "discover");
  assert.equal(calls[0]!.priority, 5);
});

test("discover is capped at 200 per run and handed over in chunks of 50", async () => {
  assert.equal(ENQUEUE_CHUNK_SIZE, 50);
  assert.equal(ENQUEUE_MAX_PER_RUN, 200);

  const { db, calls } = queueDb({ anime: [] });
  const items = Array.from({ length: 500 }, (_, index) => media(1000 + index, { popularity: 1000 - index }));

  const enqueued = await enqueueMissingAnime(items, "discover", 5, { db });

  assert.equal(enqueued, 200, "at most 200 anime per run");
  assert.deepEqual(calls.map((call) => call.items.length), [50, 50, 50, 50], "chunks of 50");
  assert.equal(calls[0]!.items[0].anilist_id, 1000, "the most popular goes first");
});

test("the airing and discover jobs call the queue helpers", () => {
  const airing = read("app/api/cron/airing/route.ts");
  const discover = read("app/api/cron/discover/route.ts");

  assert.match(airing, /queuePendingSync\(/, "airing writes pending_sync");
  assert.match(airing, /enqueueMissingAnime\(/, "airing enqueues anime with no row");
  assert.match(airing, /insertEpisodeRows/, "airing uses the inserted rows, not the whole window");
  assert.match(discover, /enqueueMissingAnime\(/, "discover enqueues missing anime");
  assert.match(airing, /skipAnilistIds/, "adults are skipped");
});

// ------------------------------------------------------------- importAnime

test("an AniList rate limit is distinguishable from a missing media", () => {
  const importSource = read("app/lib/anime-db/import.ts");
  const mediaSource = read("app/lib/anilist/medias.server.ts");
  const clientSource = read("app/lib/anilist/client.ts");

  assert.match(mediaSource, /export async function getMediaInfoResult/, "a result-typed lookup exists");
  assert.match(mediaSource, /status: 'rate_limited'/, "rate limiting is reported as itself");
  assert.match(mediaSource, /status: 'not_found'/, "and so is a missing media");
  assert.match(clientSource, /class AniListRateLimitedError/, "429s have their own error type");
  assert.match(clientSource, /Retry-After/, "Retry-After is read");
  assert.match(importSource, /getMediaInfoResult/, "importAnime uses the distinguishing lookup");
  assert.match(importSource, /systemic:true, retryAfterMs: lookup\.retryAfterMs/, "a rate limit is marked systemic");

  assert.equal(isSystemicFailure({ message: "AniList rate limited" }), true);
  assert.equal(isSystemicFailure({ message: "AniList metadata unavailable" }), true);
  assert.equal(isSystemicFailure({ message: "AniVexa timed out after 45000ms" }), true);
  assert.equal(isSystemicFailure({ message: "AniVexa returned 429" }), true);
  assert.equal(isSystemicFailure({ message: "AniVexa server error 503" }), true);
  assert.equal(isSystemicFailure({ message: "no streams found" }), false);
  assert.equal(isSystemicFailure({ message: "TypeError: cannot read x" }), false);
});

// ---------------------------------------------------------------- import queue

/** A queue db whose only job is recording the write-backs. */
function persistDb(options: { failUpdates?: boolean; errorMessage?: string } = {}) {
  const patches: Array<Record<string, any>> = [];

  return {
    patches,
    db: {
      from(table: string) {
        assert.equal(table, "anime_import_queue");
        return {
          update(patch: Record<string, any>) {
            return {
              async eq(column: string, value: any) {
                patches.push({ ...patch, [column]: value });
                if (options.failUpdates) {
                  return { error: new Error(options.errorMessage ?? "new row violates check constraint") };
                }
                return { error: null };
              },
            };
          },
        };
      },
    },
  };
}

const silent = () => {};

test("each anilist_id is imported at most once per run", async () => {
  const imported: number[] = [];
  const batch = [
    { anilist_id: 7, attempts: 1 },
    { anilist_id: 7, attempts: 1 },
    { anilist_id: 8, attempts: 1 },
  ];

  const stats = await runImportQueue({
    db: persistDb().db,
    claim: async () => batch,
    importOne: async (id) => {
      imported.push(id);
      return { status: "ok", episodes: 3 } as ImportResult;
    },
    log: silent,
  });

  assert.deepEqual(imported, [7, 8], "the duplicate id in the same batch is ignored");
  assert.ok(stats.skippedDuplicates >= 1, "the repeated id was counted as a duplicate");
  assert.equal(stats.stopped, "no_progress", "a claim of only known ids stops the run");
  assert.ok(stats.imported <= 2);
});

test("the run stops when the claim keeps returning ids it already imported", async () => {
  let claims = 0;
  const imported: number[] = [];

  const stats = await runImportQueue({
    db: persistDb().db,
    claim: async () => {
      claims += 1;
      // The same row over and over: exactly the production hot loop.
      return [{ anilist_id: 42, attempts: 1 }];
    },
    importOne: async (id) => {
      imported.push(id);
      return { status: "error", episodes: 0, message: "permanent failure" } as ImportResult;
    },
    log: silent,
  });

  assert.deepEqual(imported, [42], "imported once, never again");
  assert.equal(claims, 2, "one real batch, then the all-duplicates batch stops the loop");
  assert.equal(stats.stopped, "no_progress");
  assert.ok(stats.imported < MAX_IMPORTS_PER_RUN);
});

test("the circuit breaker opens after 10 consecutive identical failures", async () => {
  let next = 1;
  const stats = await runImportQueue({
    db: persistDb().db,
    claim: async (size) =>
      Array.from({ length: size }, () => ({ anilist_id: next++, attempts: 1 })),
    importOne: async () => ({ status: "error", episodes: 0, message: "AniVexa exploded" } as ImportResult),
    log: silent,
  });

  assert.equal(stats.stopped, "circuit_open");
  assert.equal(stats.message, "AniVexa exploded");
  assert.equal(stats.imported, CIRCUIT_FAILURE_LIMIT, "it stopped at 10, not at the 150 cap");
});

test("a different failure message resets the circuit counter", async () => {
  let next = 1;
  let failures = 0;
  const stats = await runImportQueue({
    db: persistDb().db,
    claim: async (size) => Array.from({ length: size }, () => ({ anilist_id: next++, attempts: 1 })),
    importOne: async () => {
      failures += 1;
      return { status: "error", episodes: 0, message: `failure ${failures}` } as ImportResult;
    },
    limit: 12,
    log: silent,
  });

  assert.notEqual(stats.stopped, "circuit_open", "never ten in a row of the SAME message");
  assert.equal(stats.imported, 12);
});

test("the run never imports more than 150 rows", async () => {
  let next = 1;
  const stats = await runImportQueue({
    db: persistDb().db,
    claim: async (size) => Array.from({ length: size }, () => ({ anilist_id: next++, attempts: 1 })),
    importOne: async () => ({ status: "ok", episodes: 1 } as ImportResult),
    limit: 10_000,
    log: silent,
  });

  assert.equal(MAX_IMPORTS_PER_RUN, 150);
  assert.equal(stats.imported, 150);
  assert.equal(stats.ok, 150);
  assert.equal(stats.stopped, "cap");
});

test("no_streams is mapped onto a status the table accepts", async () => {
  assert.deepEqual([...VALID_QUEUE_STATUSES], ["pending", "processing", "done", "error", "not_found"]);

  assert.equal(normalizeQueueStatus("no_streams"), "pending", "an invented status is never written back");
  assert.equal(normalizeQueueStatus("done"), "done");
  assert.equal(normalizeQueueStatus("wibble", "error"), "error");

  const early = decideQueueState({ status: "no_streams", episodes: 0 }, { attempts: 2 });
  assert.equal(early.status, "pending", "still retryable");
  assert.equal(early.terminal, false);
  assert.equal(VALID_QUEUE_STATUSES.includes(early.status as never), true);

  const late = decideQueueState({ status: "no_streams", episodes: 0 }, { attempts: 6 });
  assert.equal(late.status, "error", "terminal after enough tries");
  assert.equal(late.terminal, true);
  assert.equal(late.lastError, "no_streams");
  assert.equal(VALID_QUEUE_STATUSES.includes(late.status as never), true);

  // And through the loop: every persisted status is valid.
  const { db, patches } = persistDb();
  await runImportQueue({
    db,
    claim: async (size) => Array.from({ length: size }, (_, index) => ({ anilist_id: index + 1, attempts: 3 })),
    importOne: async () => ({ status: "no_streams", episodes: 0 } as ImportResult),
    limit: 3,
    log: silent,
  });

  assert.equal(patches.length, 3);
  for (const patch of patches) {
    assert.equal(VALID_QUEUE_STATUSES.includes(patch.status), true, `${patch.status} passes the CHECK`);
    assert.equal(patch.last_error === "no_streams" || patch.last_error === "no streams", true);
  }
});

test("a failing update is logged instead of being swallowed", async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => warnings.push(args.map(String).join(" "));

  try {
    const { db } = persistDb({ failUpdates: true });
    const stats = await runImportQueue({
      db,
      claim: async (size) => Array.from({ length: size }, (_, index) => ({ anilist_id: index + 1, attempts: 1 })),
      importOne: async () => ({ status: "ok", episodes: 1 } as ImportResult),
      limit: 2,
      log: silent,
    });

    assert.equal(stats.updateErrors, 2);
    assert.equal(warnings.filter((line) => line.includes("[import-queue] update failed")).length, 2);
    assert.ok(warnings.some((line) => line.includes("check constraint")), "the real error is in the log");
  } finally {
    console.warn = originalWarn;
  }
});

test("a systemic failure never makes the row terminal and gives the attempt back", async () => {
  const { db, patches } = persistDb();

  for (const message of ["AniList metadata unavailable: AniList rate limited (HTTP 429)", "AniVexa timed out after 45000ms"]) {
    patches.length = 0;
    const stats = await runImportQueue({
      db,
      claim: async () => [{ anilist_id: 11, attempts: 20 }],
      importOne: async () => ({ status: "error", episodes: 0, message } as ImportResult),
      log: silent,
    });

    assert.equal(stats.imported, 1);
    const patch = patches[0]!;
    assert.equal(patch.status, "pending", `"${message}" stays retryable even at 20 attempts`);
    assert.equal(patch.last_error, message);
    assert.equal(patch.attempts, 19, "the claim increment is given back");
    assert.ok(new Date(patch.next_attempt_at).getTime() > Date.now(), "rescheduled with backoff");
  }

  // A permanent failure at the same attempt count IS terminal.
  const permanent = decideQueueState({ status: "error", episodes: 0, message: "unexpected shape" }, { attempts: 20 });
  assert.equal(permanent.status, "error");
  assert.equal(permanent.terminal, true);
});

test("a rate-limited AniList result is marked systemic by importAnime", () => {
  const source = read("app/lib/anime-db/import.ts");
  assert.match(source, /lookup\.status === "rate_limited"/);
  assert.match(source, /systemic:true/);
  assert.match(source, /retryAfterMs: lookup\.retryAfterMs/);
  assert.match(source, /lookup\.status === "not_found" && !current/, "a missing media is not found, not an error");
});

test("the import-queue route delegates to the tested loop and logs a summary", () => {
  const route = read("app/api/cron/import-queue/route.ts");

  assert.match(route, /runImportQueue\(/, "the loop lives in a tested module");
  assert.match(route, /console\.log\("\[import-queue\] run"/, "one summary per run");
  assert.match(route, /stats\.stopped !== "circuit_open"/, "an open circuit is not chained");
});
