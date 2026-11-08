// The logo cron: claim → fetch → write, with an in-memory Supabase stand-in.
//
// Covers the four outcomes a batch has to survive (found, no TMDB id, a 404
// that falls back from /movie to /tv, and a 429), plus idempotency: a second
// run must not look at the same rows again.

import assert from "node:assert/strict";
import test from "node:test";
import { processLogoCandidates } from "@/app/lib/tmdb/fill";
import { GET as logosCronGET } from "@/app/api/cron/logos/route";

type Row = Record<string, any>;

type Filter = { op: "eq" | "is" | "lt" | "notIs" | "gt"; column: string; value: unknown };

function matches(row: Row, filter: Filter): boolean {
  const value = row[filter.column];

  if (filter.op === "eq") return value === filter.value;
  if (filter.op === "is") return filter.value === null ? value === null || value === undefined : value === filter.value;
  if (filter.op === "notIs") return filter.value === null ? value !== null && value !== undefined : value !== filter.value;

  if (filter.op === "lt") {
    if (value === null || value === undefined) return false;
    return String(value) < String(filter.value);
  }

  if (value === null || value === undefined) return false;

  return String(value) > String(filter.value);
}

function createDb(rows: Row[], options: { failSelect?: boolean } = {}) {
  const state = { updates: 0, selects: 0 };

  function query() {
    const filters: Filter[] = [];
    let ordering: { column: string; ascending: boolean; nullsFirst: boolean } | null = null;
    let limit: number | null = null;
    let patch: Row | null = null;
    let count = false;
    let returning: string[] | null = null;

    const builder: any = {
      select(_columns?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count) count = true;
        if (_columns) returning = _columns.split(",").map((column) => column.trim());
        return builder;
      },
      update(next: Row) {
        patch = next;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push({ op: "eq", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push({ op: "is", column, value });
        return builder;
      },
      lt(column: string, value: unknown) {
        filters.push({ op: "lt", column, value });
        return builder;
      },
      not(column: string, op: string, value: unknown) {
        filters.push({ op: op === "is" ? "notIs" : "gt", column, value });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        ordering = { column, ascending: opts?.ascending !== false, nullsFirst: opts?.nullsFirst === true };
        return builder;
      },
      limit(value: number) {
        limit = value;
        return builder;
      },
      maybeSingle() {
        limit = 1;
        return builder;
      },
      single() {
        limit = 1;
        return builder;
      },
      async then(resolve: (value: unknown) => unknown) {
        resolve(await builder.exec());
      },
      async exec() {
        if (options.failSelect && !patch) {
          return { data: null, count: null, error: { code: "42703", message: "column anime.logo_path does not exist" } };
        }

        const matched = rows.filter((row) => filters.every((filter) => matches(row, filter)));

        if (patch) {
          state.updates += 1;

          for (const row of matched) Object.assign(row, patch);

          return { data: returning ? matched.map((row) => ({ ...row })) : null, error: null };
        }

        state.selects += 1;

        if (count) return { data: null, count: matched.length, error: null };

        let selected = [...matched];

        if (ordering) {
          const { column, ascending, nullsFirst } = ordering;

          selected.sort((a, b) => {
            const left = a[column];
            const right = b[column];

            const leftNull = left === null || left === undefined;
            const rightNull = right === null || right === undefined;

            if (leftNull && rightNull) return 0;
            if (leftNull) return nullsFirst ? -1 : 1;
            if (rightNull) return nullsFirst ? 1 : -1;

            if (left === right) return 0;

            return (left < right ? -1 : 1) * (ascending ? 1 : -1);
          });
        }

        if (limit !== null) selected = selected.slice(0, limit);

        return { data: selected.map((row) => ({ ...row })), error: null };
      },
    };

    return builder;
  }

  return {
    state,
    rows,
    from(table: string) {
      assert.equal(table, "anime");
      return query();
    },
  };
}

const originalKey = process.env.TMDB_API_KEY;
const originalToken = process.env.TMDB_READ_ACCESS_TOKEN;
const originalFetch = globalThis.fetch;
const originalSecret = process.env.CRON_SECRET;

test.beforeEach(() => {
  delete process.env.TMDB_READ_ACCESS_TOKEN;
  process.env.TMDB_API_KEY = "test-v3-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalKey === undefined) delete process.env.TMDB_API_KEY;
  else process.env.TMDB_API_KEY = originalKey;

  if (originalToken === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN;
  else process.env.TMDB_READ_ACCESS_TOKEN = originalToken;

  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const LOGO_BODY = { logos: [{ file_path: "/one-piece.png", aspect_ratio: 2.5, width: 800, iso_639_1: "en", vote_average: 7 }] };

test("one batch: found, no-tmdb-id, movie->tv fallback and a 429", async () => {
  const rows: Row[] = [
    { anilist_id: 1, score: 90, mappings: { themoviedbId: 100, format: "TV" }, format: "TV" },
    { anilist_id: 2, score: 80, mappings: {}, format: "TV" },
    { anilist_id: 3, score: 70, mappings: { themoviedbId: 300, format: "MOVIE" }, format: "MOVIE" },
    { anilist_id: 4, score: 60, mappings: { themoviedbId: 400, format: "TV" }, format: "TV" },
  ];

  const db = createDb(rows);
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/tv/100/")) return json(LOGO_BODY);
    if (url.includes("/tv/400/")) return new Response("slow down", { status: 429, headers: { "Retry-After": "30" } });
    if (url.includes("/movie/300/")) return new Response("not found", { status: 404 });
    if (url.includes("/tv/300/")) return json(LOGO_BODY);

    return json({ logos: [] });
  }) as typeof fetch;

  const stats = await processLogoCandidates({ db, batch: 10, force: false });

  assert.equal(stats.claimed, 4);
  assert.equal(stats.found, 2);
  assert.equal(stats.none, 1);
  assert.equal(stats.errors, 0);
  assert.equal(stats.skipped, 0);
  assert.equal(stats.rateLimited, true);
  assert.equal(stats.retryAfterMs, 30000);

  // The row without a TMDB id was stamped without any HTTP call.
  assert.equal(
    calls.some((url) => url.includes("/2/")),
    false,
    "no TMDB call for a row without a TMDB id",
  );

  const one = rows.find((row) => row.anilist_id === 1)!;
  assert.equal(one.logo_path, "/one-piece.png");
  assert.equal(one.logo_status, "found");
  assert.equal(one.logo_aspect_ratio, 2.5);
  assert.equal(one.logo_width, 800);
  assert.ok(one.logo_checked_at, "the checked timestamp is written");

  const two = rows.find((row) => row.anilist_id === 2)!;
  assert.equal(two.logo_status, "none");
  assert.equal(two.logo_path ?? null, null);

  assert.equal(rows.find((row) => row.anilist_id === 3)!.logo_status, "found", "the movie fell back to tv");

  const four = rows.find((row) => row.anilist_id === 4)!;
  assert.equal(four.logo_checked_at ?? null, null, "a rate-limited row is released");
  assert.equal(four.logo_path ?? null, null);
});

test("a second run does not re-process the rows the first one touched", async () => {
  const rows: Row[] = [
    { anilist_id: 1, score: 90, mappings: { themoviedbId: 100, format: "TV" }, format: "TV" },
    { anilist_id: 2, score: 80, mappings: null, format: "TV" },
    { anilist_id: 3, score: 70, mappings: { themoviedbId: 300 }, format: "TV" },
  ];

  const db = createDb(rows);
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    return json(LOGO_BODY);
  }) as typeof fetch;

  const first = await processLogoCandidates({ db, batch: 10 });
  assert.equal(first.claimed, 3);
  assert.equal(first.found, 2, "only the rows with a TMDB id get a logo");
  assert.equal(first.none, 1, "the row without mappings is stamped none");
  assert.equal(first.remaining, 0);
  assert.equal(calls, 2, "one call per row that has a TMDB id");

  const second = await processLogoCandidates({ db, batch: 10 });

  assert.equal(second.claimed, 0);
  assert.equal(second.found, 0);
  assert.equal(calls, 2, "nothing is fetched twice");
});

test("rows that already have a logo are only re-checked with force", async () => {
  const rows: Row[] = [
    {
      anilist_id: 1,
      score: 90,
      mappings: { themoviedbId: 100 },
      format: "TV",
      logo_path: "/existing.png",
      logo_status: "found",
      logo_checked_at: new Date().toISOString(),
    },
  ];

  const db = createDb(rows);
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    return json(LOGO_BODY);
  }) as typeof fetch;

  const skipped = await processLogoCandidates({ db, batch: 10 });
  assert.equal(skipped.claimed, 0);
  assert.equal(calls, 0);

  const forced = await processLogoCandidates({ db, batch: 10, force: true });
  assert.equal(forced.claimed, 1);
  assert.equal(calls, 1);
});

test("no candidates at all when the migration has not run", async () => {
  const rows: Row[] = [{ anilist_id: 1, score: 10, mappings: { themoviedbId: 5 } }];
  const db = createDb(rows, { failSelect: true });

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return json(LOGO_BODY);
  }) as typeof fetch;

  const stats = await processLogoCandidates({ db, batch: 10 });

  assert.equal(stats.claimed, 0);
  assert.equal(stats.found, 0);
  assert.equal(calls, 0, "a missing column is not an error, just no work");
});

test("without a TMDB key nothing is fetched and nothing fails", async () => {
  delete process.env.TMDB_API_KEY;

  const rows: Row[] = [{ anilist_id: 1, score: 10, mappings: { themoviedbId: 5 } }];
  const db = createDb(rows);

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return json(LOGO_BODY);
  }) as typeof fetch;

  const stats = await processLogoCandidates({ db, batch: 10 });

  assert.equal(stats.claimed, 0);
  assert.equal(calls, 0);
});

test("a single row can be targeted with anilist_id", async () => {
  const rows: Row[] = [
    { anilist_id: 1, score: 90, mappings: { themoviedbId: 100 } },
    { anilist_id: 2, score: 80, mappings: { themoviedbId: 200 } },
  ];

  const db = createDb(rows);
  const seen: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return json(LOGO_BODY);
  }) as typeof fetch;

  const stats = await processLogoCandidates({ db, batch: 10, anilistId: 2 });

  assert.equal(stats.claimed, 1);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /\/tv\/200\//);
});

// ------------------------------------------------- stale claims (killed run)

const HOUR = 60 * 60 * 1000;

function ago(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

test("a row left behind by a killed run is selected, claimed and processed", async () => {
  // The claim was written, the result never was: checked 2 hours ago, no status.
  const rows: Row[] = [
    {
      anilist_id: 7,
      score: 50,
      mappings: { themoviedbId: 700 },
      format: "TV",
      logo_path: null,
      logo_status: null,
      logo_checked_at: ago(2 * HOUR),
    },
  ];

  const db = createDb(rows);
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return json(LOGO_BODY);
  }) as typeof fetch;

  const stats = await processLogoCandidates({ db, batch: 10 });

  assert.equal(stats.claimed, 1, "the stale claim is claimed again");
  assert.equal(stats.skipped, 0, "and it is not discarded as already taken");
  assert.equal(stats.found, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/tv\/700\//);

  const row = rows[0];
  assert.equal(row.logo_path, "/one-piece.png", "the result is written this time");
  assert.equal(row.logo_status, "found");

  // And it is not picked up again now that it has a result.
  const second = await processLogoCandidates({ db, batch: 10 });
  assert.equal(second.claimed, 0);
  assert.equal(calls.length, 1);
});

test("a claim made 5 minutes ago is still left alone", async () => {
  // Some other run is probably still working on it.
  const rows: Row[] = [
    {
      anilist_id: 8,
      score: 50,
      mappings: { themoviedbId: 800 },
      logo_path: null,
      logo_status: null,
      logo_checked_at: ago(5 * 60 * 1000),
    },
  ];

  const db = createDb(rows);
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    return json(LOGO_BODY);
  }) as typeof fetch;

  const stats = await processLogoCandidates({ db, batch: 10 });

  assert.equal(stats.claimed, 0, "a fresh claim is not a candidate");
  assert.equal(calls, 0);
  assert.equal(rows[0].logo_path ?? null, null);
});

test("a 'none' row checked 2 hours ago is not pulled in by the stale group", async () => {
  // It answered, it just had no logo: it waits for the 30-day recheck.
  const rows: Row[] = [
    {
      anilist_id: 9,
      score: 50,
      mappings: { themoviedbId: 900 },
      logo_path: null,
      logo_status: "none",
      logo_checked_at: ago(2 * HOUR),
    },
  ];

  const db = createDb(rows);
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    return json(LOGO_BODY);
  }) as typeof fetch;

  const stats = await processLogoCandidates({ db, batch: 10 });

  assert.equal(stats.claimed, 0);
  assert.equal(calls, 0);
  assert.equal(rows[0].logo_status, "none");
});

// ------------------------------------------------------------- route: auth

test("the logo cron refuses a missing secret", async () => {
  process.env.CRON_SECRET = "s3cret-value";

  const response = await logosCronGET(new Request("https://kumoritv.top/api/cron/logos"));

  assert.equal(response.status, 401);
});

test("the logo cron reports missing configuration with 503", async () => {
  delete process.env.CRON_SECRET;

  const response = await logosCronGET(new Request("https://kumoritv.top/api/cron/logos"));

  assert.equal(response.status, 503);
});

test("the logo cron runs inline with wait=1", async () => {
  process.env.CRON_SECRET = "s3cret-value";

  const response = await logosCronGET(
    new Request("https://kumoritv.top/api/cron/logos?wait=1", {
      headers: { Authorization: "Bearer s3cret-value" },
    }),
  );

  assert.equal(response.status, 200);

  const body = (await response.json()) as Record<string, number | boolean>;

  assert.equal(body.claimed, 0, "no admin client in a test environment means no work, not a crash");
  assert.equal(body.rateLimited, false);
});
