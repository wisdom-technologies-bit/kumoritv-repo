import assert from "node:assert/strict";
import test from "node:test";
import {
  CHUNK_SIZE,
  ROW_PAGE_SIZE,
  RECENT_EPISODE_LIMIT,
  countRows,
  fetchEpisodeSlice,
  fetchMediaSlice,
  fetchRecentEpisodes,
  readRowsPaged,
  sitemapIndexFiles,
} from "../../lib/sitemap";

type Row = Record<string, any>;

/**
 * Supabase/PostgREST returns at most 1000 rows per request, whatever range or
 * limit is asked for. This fake enforces exactly that, so a single oversized
 * `.range(0, 39999)` shows up as a truncated result instead of passing silently.
 */
class CappedDb {
  cap = 1000;
  tables: Record<string, Row[]>;
  requests: Array<{ table: string; from: number; to: number; returned: number }> = [];

  constructor(seed: Record<string, Row[]> = {}) {
    this.tables = seed;
  }

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table]!;
  }

  from(table: string) {
    return new CappedQuery(this, table);
  }
}

class CappedQuery implements PromiseLike<{ data: any; error: any; count: number | null }> {
  private columns: string | undefined;
  private wantsCount = false;
  private headOnly = false;
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private conditions: Array<{ column: string; op: "eq" | "gte"; value: any }> = [];
  private rangeFrom = 0;
  private rangeTo = Number.MAX_SAFE_INTEGER;
  private limitCount: number | null = null;

  constructor(private db: CappedDb, private table: string) {}

  select(columns?: string, options?: { count?: string; head?: boolean }) {
    this.columns = columns;
    this.wantsCount = Boolean(options?.count);
    this.headOnly = options?.head === true;
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  eq(column: string, value: any) {
    this.conditions.push({ column, op: "eq", value });
    return this;
  }

  gte(column: string, value: any) {
    this.conditions.push({ column, op: "gte", value });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  private matching(): Row[] {
    let rows = this.db.rows(this.table).slice();

    for (const condition of this.conditions) {
      rows = rows.filter((row) =>
        condition.op === "eq"
          ? row[condition.column] === condition.value
          : String(row[condition.column]) >= String(condition.value),
      );
    }

    if (this.orders.length) {
      rows.sort((left, right) => {
        for (const order of this.orders) {
          const a = left[order.column];
          const b = right[order.column];
          if (a === b) continue;
          const result = a < b ? -1 : 1;
          return order.ascending ? result : -result;
        }
        return 0;
      });
    }

    return rows;
  }

  private run() {
    const matching = this.matching();

    if (this.headOnly) {
      return { data: null, error: null, count: this.wantsCount ? matching.length : null };
    }

    let to = this.rangeTo;
    if (this.limitCount !== null) to = Math.min(to, this.rangeFrom + this.limitCount - 1);
    // The server cap: never more than 1000 rows in one response.
    to = Math.min(to, this.rangeFrom + this.db.cap - 1);

    const slice = matching.slice(this.rangeFrom, Math.max(this.rangeFrom, to) + 1);
    this.db.requests.push({ table: this.table, from: this.rangeFrom, to, returned: slice.length });

    return { data: slice, error: null, count: this.wantsCount ? matching.length : null };
  }

  then<T1 = { data: any; error: any; count: number | null }, T2 = never>(
    onFulfilled?: ((value: { data: any; error: any; count: number | null }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    try {
      return Promise.resolve(this.run()).then(onFulfilled, onRejected);
    } catch (error) {
      return Promise.reject(error).then(onFulfilled, onRejected);
    }
  }
}

const episodeRow = (anilistId: number, episode: number, updatedAt = "2026-10-30T00:00:00.000Z"): Row => ({
  anilist_id: anilistId,
  episode_number: episode,
  updated_at: updatedAt,
});

/** 10000 playable episodes: 2 per anime across 5000 anime. */
function tenThousandEpisodes(): Row[] {
  return Array.from({ length: 5000 }, (_, index) => [
    episodeRow(100000 + index, 1),
    episodeRow(100000 + index, 2),
  ]).flat();
}

test("a 10000-row chunk comes back whole and in order, not capped at 1000", async () => {
  const db = new CappedDb({ sitemap_episodes: tenThousandEpisodes() });

  const rows = await fetchEpisodeSlice(db as never, 1);

  assert.equal(CHUNK_SIZE, 10000, "a chunk is 10000 rows");
  assert.equal(rows.length, 10000, "every row in the chunk is returned");

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!;
    const current = rows[index]!;
    const ordered =
      previous.anilist_id < current.anilist_id ||
      (previous.anilist_id === current.anilist_id && previous.episode_number < current.episode_number);
    assert.ok(ordered, `row ${index} is out of order`);
  }

  const keys = new Set(rows.map((row) => `${row.anilist_id}-${row.episode_number}`));
  assert.equal(keys.size, 10000, "no duplicates");

  assert.equal(db.requests.length, 10, "ten 1000-row pages, one per request");
  for (const request of db.requests) {
    assert.ok(request.returned <= 1000, "the fake never served more than 1000 rows");
    assert.ok(request.to - request.from + 1 <= ROW_PAGE_SIZE, "each request stays inside one page");
  }
});

test("page 2 starts exactly where page 1 ended: no gaps, no repeats", async () => {
  const db = new CappedDb({
    sitemap_episodes: Array.from({ length: 2500 }, (_, index) => episodeRow(1, index + 1)),
  });

  const first = await fetchEpisodeSlice(db as never, 1, 1000);
  const second = await fetchEpisodeSlice(db as never, 2, 1000);

  assert.equal(first.length, 1000);
  assert.equal(second.length, 1000);
  assert.equal(first[0]!.episode_number, 1);
  assert.equal(first[999]!.episode_number, 1000);
  assert.equal(second[0]!.episode_number, 1001, "the second page starts right after the first");

  const numbers = [...first, ...second].map((row) => row.episode_number);
  assert.equal(new Set(numbers).size, 2000, "no duplicates across pages");
  assert.equal(Math.min(...numbers), 1);
  assert.equal(Math.max(...numbers), 2000);

  const third = await fetchEpisodeSlice(db as never, 3, 1000);
  assert.equal(third.length, 500, "the last page is a short page");
  assert.equal(third[0]!.episode_number, 2001);
});

test("a chunk that ends mid-page stops after the short page", async () => {
  const db = new CappedDb({
    sitemap_episodes: Array.from({ length: 1600 }, (_, index) => episodeRow(1, index + 1)),
  });

  const rows = await fetchEpisodeSlice(db as never, 1, 1200);
  assert.equal(rows.length, 1200, "the chunk size is respected, not the table size");
  assert.equal(db.requests.length, 2, "one full page plus the partial one");
});

test("media chunks use the same paged read", async () => {
  const db = new CappedDb({
    anime: Array.from({ length: 2600 }, (_, index) => ({
      anilist_id: index + 1,
      updated_at: "2026-10-30T00:00:00.000Z",
    })),
  });

  const rows = await fetchMediaSlice(db as never, 1);

  assert.equal(rows.length, 2600);
  assert.equal(rows[0]!.anilist_id, 1);
  assert.equal(rows[2599]!.anilist_id, 2600);
  assert.equal(db.requests.length, 3);
});

test("new.xml reads more than one page of recent episodes", async () => {
  const db = new CappedDb({
    sitemap_episodes: Array.from({ length: 1500 }, (_, index) =>
      episodeRow(1, index + 1, new Date(Date.now() - index * 60000).toISOString()),
    ),
  });

  const rows = await fetchRecentEpisodes(db as never, 48);

  assert.ok(rows.length > 1000, `expected more than 1000 rows, got ${rows.length}`);
  assert.equal(rows.length, 1500, "all recent rows are returned, not just the first page");
  assert.ok(db.requests.length >= 2, "the read was paged");
});

test("new.xml stops at RECENT_EPISODE_LIMIT even when more rows exist", async () => {
  const db = new CappedDb({
    sitemap_episodes: Array.from({ length: RECENT_EPISODE_LIMIT + 500 }, (_, index) =>
      episodeRow(1, index + 1),
    ),
  });

  const rows = await fetchRecentEpisodes(db as never, 48);

  assert.equal(rows.length, RECENT_EPISODE_LIMIT, "the cap still holds");
  assert.ok(db.requests.length <= Math.ceil(RECENT_EPISODE_LIMIT / ROW_PAGE_SIZE));
});

test("new.xml only keeps rows inside the 48h window", async () => {
  const now = Date.now();
  const db = new CappedDb({
    sitemap_episodes: [
      episodeRow(1, 1, new Date(now - 3600000).toISOString()),
      episodeRow(2, 1, new Date(now - 47 * 3600000).toISOString()),
      episodeRow(3, 1, new Date(now - 49 * 3600000).toISOString()),
    ],
  });

  const rows = await fetchRecentEpisodes(db as never, 48);

  assert.deepEqual(
    rows.map((row) => row.anilist_id).sort((a, b) => a - b),
    [1, 2],
  );
});

test("the sitemap index derives its file count from CHUNK_SIZE", async () => {
  const count = 25000;
  const db = new CappedDb({
    sitemap_episodes: Array.from({ length: count }, (_, index) => episodeRow(index + 1, 1)),
    anime: Array.from({ length: count }, (_, index) => ({ anilist_id: index + 1 })),
  });

  const episodes = await countRows(db as never, "sitemap_episodes");
  const anime = await countRows(db as never, "anime");
  assert.equal(episodes, count, "the head count is not capped at 1000");

  const files = sitemapIndexFiles(anime, episodes).map((file) => file.loc);

  assert.equal(files.filter((loc) => loc.includes("/episodes-")).length, Math.ceil(count / CHUNK_SIZE));
  assert.equal(files.filter((loc) => loc.includes("/anime-")).length, Math.ceil(count / CHUNK_SIZE));
  assert.ok(files.includes("https://kumoritv.top/sitemaps/episodes-3.xml"));
  assert.ok(!files.includes("https://kumoritv.top/sitemaps/episodes-4.xml"));
});

test("the paged read tolerates a client without .range", async () => {
  const rows = await readRowsPaged(
    {
      from: () => ({
        select: () => {
          const query: any = {
            order: () => query,
            then: (resolve: any) =>
              Promise.resolve({ data: [episodeRow(1, 1)], error: null }).then(resolve),
          };
          return query;
        },
      }),
    } as never,
    {
      table: "sitemap_episodes",
      columns: "anilist_id,episode_number,updated_at",
      order: ["anilist_id", "episode_number"],
      chunkStart: 0,
      chunkEnd: 9999,
    },
  );

  assert.equal(rows.length, 1);
});
