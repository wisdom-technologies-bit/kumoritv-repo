// Prompt 34 Part B: the sitemap chunks were HTTP 500 for Googlebot.
//
// Root cause: `/sitemaps/episodes-N.xml` walked the `sitemap_episodes` VIEW with
// `.range(offset, ...)` in 1000-row pages, so every page deep in the file
// re-scanned and re-sorted the whole join (1.4 s for chunk 1, 13.7 s past row
// 40,000) and the unhandled throw became a 500. The fix reads a materialised,
// densely ranked view by `rn` range, caches per file, and never answers a bare
// 500 or a 200 with an empty urlset.

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  CHUNK_SIZE,
  SITEMAP_MAX_URLS_PER_FILE,
  SITEMAP_EPISODES_RANKED_VIEW,
  SITEMAP_EPISODES_VIEW,
  assertSitemapWithinLimits,
  buildChunkSitemap,
  buildSitemapIndexPayload,
  chunkCountFor,
  chunkRange,
  episodeChunkCountStable,
  episodeChunkLastmod,
  fetchEpisodeSlice,
  parseSitemapFileName,
  peekLastGoodEpisodeRows,
  resetRankedProbe,
  setRankedViewAvailableOverride,
  sitemapFileList,
  sitemapIndexFiles,
  xmlEscape,
} from "../../lib/sitemap";
import {
  clearSitemapMemoryCache,
  loadSitemap,
  memorySitemapEntry,
  sitemapErrorResponse,
  sitemapHttpResult,
  SITEMAP_CACHE_CONTROL,
  SITEMAP_MEMORY_TTL_MS,
} from "../../lib/sitemap-cache";
import { GET as chunkRoute } from "@/app/sitemaps/[file]/route";
import { GET as indexRoute } from "@/app/sitemap.xml/route";
import { GET as staticRoute } from "@/app/sitemaps/static.xml/route";

// --------------------------------------------------------------------------
// A PostgREST-shaped fake that records what the sitemap code actually asks for.
// --------------------------------------------------------------------------

type Row = Record<string, any>;

class FakeQuery implements PromiseLike<{ data: any; error: any; count: number | null }> {
  private conditions: Array<{ column: string; op: "eq" | "gte" | "lte"; value: any }> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private from_ = 0;
  private to_ = Number.MAX_SAFE_INTEGER;
  private limitCount: number | null = null;
  private wantsCount = false;
  private headOnly = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
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

  lte(column: string, value: any) {
    this.conditions.push({ column, op: "lte", value });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.from_ = from;
    this.to_ = to;
    return this;
  }

  private rows(): Row[] {
    let rows = (this.db.tables[this.table] ?? []).slice();
    for (const condition of this.conditions) {
      rows = rows.filter((row) => {
        if (condition.op === "eq") return row[condition.column] === condition.value;
        if (row[condition.column] == null) return false;
        const numeric =
          typeof row[condition.column] === "number" && typeof condition.value === "number";
        const left = numeric ? row[condition.column] : String(row[condition.column]);
        const right = numeric ? condition.value : String(condition.value);
        return condition.op === "gte" ? left >= right : left <= right;
      });
    }
    for (const order of this.orders.slice().reverse()) {
      rows.sort((left, right) => {
        const a = left[order.column];
        const b = right[order.column];
        if (a === b) return 0;
        const result = a < b ? -1 : 1;
        return order.ascending ? result : -result;
      });
    }
    return rows;
  }

  then<R1 = { data: any; error: any; count: number | null }, R2 = never>(
    onfulfilled?: ((value: { data: any; error: any; count: number | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const failure = this.db.failures[this.table];
    const result = (() => {
      if (failure) return { data: null, error: { message: failure }, count: null };
      const matching = this.rows();
      if (this.wantsCount) {
        return { data: this.headOnly ? null : matching.slice(this.from_, this.to_ + 1), error: null, count: matching.length };
      }
      let page = matching.slice(this.from_, this.to_ + 1);
      // PostgREST caps every response at 1000 rows whatever was asked.
      if (page.length > 1000) page = page.slice(0, 1000);
      if (this.limitCount !== null) page = page.slice(0, this.limitCount);
      this.db.requests.push({ table: this.table, from: this.from_, to: this.to_, returned: page.length });
      return { data: page, error: null, count: null };
    })();
    return Promise.resolve(result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  failures: Record<string, string> = {};
  requests: Array<{ table: string; from: number; to: number; returned: number }> = [];

  constructor(seed: Record<string, Row[]> = {}) {
    this.tables = seed;
  }

  from(table: string) {
    return new FakeQuery(this, table) as any;
  }
}

const isoMinutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** `playable` episodes, ranked exactly like docs/sql/sitemap-chunks.sql does. */
function seedEpisodes(count: number, anime = 3500) {
  const episodes: Row[] = [];
  const ranked: Row[] = [];
  for (let index = 1; index <= count; index += 1) {
    const anilist = 100000 + Math.floor((index - 1) / 10);
    const number = ((index - 1) % 10) + 1;
    const row = {
      anilist_id: anilist,
      episode_number: number,
      updated_at: isoMinutesAgo(index),
      air_date: `2024-01-${String((index % 28) + 1).padStart(2, "0")}`,
    };
    episodes.push(row);
    ranked.push({ rn: index, ...row });
  }
  return {
    anime: Array.from({ length: anime }, (_, index) => ({ anilist_id: 100000 + index, updated_at: isoMinutesAgo(index) })),
    [SITEMAP_EPISODES_VIEW]: episodes,
    [SITEMAP_EPISODES_RANKED_VIEW]: ranked,
  };
}

/**
 * Parses the XML the way a browser or Googlebot would. jsdom throws a
 * SyntaxError for malformed input (it does not hand back a parsererror node),
 * so a broken file fails the assertion instead of passing quietly.
 */
function assertWellFormed(xml: string, label: string) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/, `${label} starts with the XML declaration`);
  try {
    return new JSDOM(xml, { contentType: "text/xml" }).window.document;
  } catch (error) {
    assert.fail(`${label} is not well-formed XML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

test.beforeEach(() => {
  resetRankedProbe();
  clearSitemapMemoryCache();
});

// --------------------------------------------------------------- file names

test("parseSitemapFileName accepts chunks and rejects everything else", () => {
  assert.deepEqual(parseSitemapFileName("episodes-1.xml"), { kind: "episodes", page: 1 });
  assert.deepEqual(parseSitemapFileName("anime-27.xml"), { kind: "anime", page: 27 });
  assert.deepEqual(parseSitemapFileName("episodes-999.xml"), { kind: "episodes", page: 999 });

  // page 0 does not exist: chunks are 1-based.
  assert.equal(parseSitemapFileName("episodes-0.xml"), null);
  assert.equal(parseSitemapFileName("anime-0.xml"), null);
  // A gzipped name is not served by this route (no encoding of our own).
  assert.equal(parseSitemapFileName("anime-1.xml.gz"), null);
  // No path tricks, no other prefixes, no missing extension.
  assert.equal(parseSitemapFileName("../episodes-1.xml"), null);
  assert.equal(parseSitemapFileName("episodes-1.XML"), null);
  assert.equal(parseSitemapFileName("episodes-1-2.xml"), null);
  assert.equal(parseSitemapFileName("manga-1.xml"), null);
  assert.equal(parseSitemapFileName("sitemap.xml"), null);
  assert.equal(parseSitemapFileName(undefined), null);
});

// ------------------------------------------------------------- chunk maths

test("chunk ranges are 1-based rn windows with no gap and no overlap", () => {
  assert.deepEqual(chunkRange(1), { start: 1, end: 10_000 });
  assert.deepEqual(chunkRange(2), { start: 10_001, end: 20_000 });
  assert.deepEqual(chunkRange(4), { start: 30_001, end: 40_000 });
  assert.deepEqual(chunkRange(0), { start: 1, end: 10_000 }, "page 0 clamps to the first chunk");

  // Boundaries: 10,000 rows is one full file, 10,001 needs two, and the last
  // chunk of 35,011 rows holds 5,011.
  assert.equal(chunkCountFor(10_000), 1);
  assert.equal(chunkCountFor(10_001), 2);
  assert.equal(chunkCountFor(35_011), 4);
  assert.equal(chunkCountFor(0), 0);
  const last = chunkRange(4);
  assert.equal(35_011 - last.start + 1, 5_011, "the tail chunk is partial, not padded");
});

test("the ranked read is an rn range, never a deep OFFSET", async () => {
  setRankedViewAvailableOverride(true);
  const db = new FakeDb(seedEpisodes(35_011));

  const rows = await fetchEpisodeSlice(db as any, 4);
  assert.equal(rows.length, 5_011);
  assert.equal(rows[0]!.episode_number, 1);

  // Every request asks for at most PostgREST's 1000-row page of an rn window:
  // the query itself is `rn between 30001 and 40000`, so the offset is shallow.
  assert.ok(db.requests.length >= 6, "a 5,011-row chunk is paged");
  for (const request of db.requests) {
    assert.equal(request.table, SITEMAP_EPISODES_RANKED_VIEW);
    assert.ok(request.to - request.from + 1 <= 1000, "never asks for more than 1000 rows");
  }
});

test("fetchEpisodeSlice falls back to the old view when the ranked one is missing", async () => {
  setRankedViewAvailableOverride(false);
  const db = new FakeDb(seedEpisodes(2_500));

  const rows = await fetchEpisodeSlice(db as any, 1);
  assert.equal(rows.length, 2_500, "the fallback reads every row of the chunk, all of the data there is");
  assert.ok(db.requests.length >= 3, "still paged at PostgREST's 1000-row cap");
  for (const request of db.requests) {
    assert.ok(request.to - request.from + 1 <= 1000, "never asks for more than 1000 rows");
  }

  // A view the database does not have yet must not throw.
  const emptyDb = new FakeDb({ [SITEMAP_EPISODES_VIEW]: [] });
  assert.deepEqual(await fetchEpisodeSlice(emptyDb as any, 1), []);

  // And a ranked-view error (view being recreated, statement timeout) falls
  // back to the old read for that request instead of failing the file.
  setRankedViewAvailableOverride(true);
  const broken = new FakeDb(seedEpisodes(50));
  broken.failures[SITEMAP_EPISODES_RANKED_VIEW] = "relation does not exist";
  const rescued = await fetchEpisodeSlice(broken as any, 1);
  assert.equal(rescued.length, 50, "served from the old view");
  assert.equal(broken.requests.at(-1)?.table, SITEMAP_EPISODES_VIEW);
});

// ------------------------------------------------------------------ counts

test("the chunk count comes from max(rn), not count:'exact' on the view", async () => {
  setRankedViewAvailableOverride(true);
  const db = new FakeDb(seedEpisodes(35_011));

  const counted = await episodeChunkCountStable(db as any);
  assert.deepEqual(counted, { chunks: 4, rows: 35_011, source: "ranked" });
  assert.equal(peekLastGoodEpisodeRows(), 35_011);

  // The view is never asked for an exact count on the ranked path.
  assert.equal(
    db.requests.some((request) => request.table === SITEMAP_EPISODES_VIEW),
    false,
  );
});

test("a failed count reuses the last good one and never drops chunks from the index", async () => {
  setRankedViewAvailableOverride(true);
  const db = new FakeDb(seedEpisodes(35_011));
  assert.equal((await episodeChunkCountStable(db as any)).chunks, 4);

  // Production failure mode: the count read times out.
  db.failures[SITEMAP_EPISODES_RANKED_VIEW] = "canceling statement due to statement timeout";
  const fallback = await episodeChunkCountStable(db as any);
  assert.deepEqual(fallback, { chunks: 4, rows: 35_011, source: "last-good" });

  // The index built while the count is failing still lists all four chunks.
  const payload = await buildSitemapIndexPayload(db as any);
  const locs = [...payload.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
  assert.equal(locs.filter((loc) => loc.includes("/episodes-")).length, 4, "no chunk disappears from the index");
});

test("the index lists exactly the chunks that have rows", async () => {
  setRankedViewAvailableOverride(true);
  const db = new FakeDb(seedEpisodes(35_011));

  const payload = await buildSitemapIndexPayload(db as any);
  const parsed = assertWellFormed(payload.body, "sitemap.xml");
  const locs = [...parsed.querySelectorAll("sitemap > loc")].map((node) => node.textContent ?? "");

  assert.equal(locs[0], "https://kumoritv.top/sitemaps/static.xml");
  assert.equal(locs[1], "https://kumoritv.top/sitemaps/new.xml");
  assert.deepEqual(
    locs.filter((loc) => loc.includes("/episodes-")),
    [1, 2, 3, 4].map((page) => `https://kumoritv.top/sitemaps/episodes-${page}.xml`),
    "four chunks, matching the data - never the 19 the stale count listed",
  );

  // Chunk 4 exists, chunk 5 does not: the index count equals the number of
  // chunk files the route serves with rows.
  const served = [];
  for (const page of [1, 2, 3, 4, 5]) {
    const chunk = await buildChunkSitemap({ kind: "episodes", page }, db as any);
    served.push(chunk.empty ? 404 : 200);
  }
  assert.deepEqual(served, [200, 200, 200, 200, 404]);
  assert.equal(
    locs.filter((loc) => loc.includes("/episodes-")).length,
    served.filter((status) => status === 200).length,
    "index count === non-empty chunk files",
  );
});

test("per-chunk lastmod comes from the ranked view and is cheap", async () => {
  setRankedViewAvailableOverride(true);
  const db = new FakeDb(seedEpisodes(12_000));

  const lastmod = await episodeChunkLastmod(db as any, 2);
  assert.ok(lastmod && !Number.isNaN(Date.parse(lastmod)), "a usable ISO timestamp");

  setRankedViewAvailableOverride(false);
  assert.equal(await episodeChunkLastmod(db as any, 2), null, "unknown without the ranked view");
});

// ------------------------------------------------------------- 404 and 503

test("a chunk past the data is a 404, never a 200 with an empty urlset", async () => {
  setRankedViewAvailableOverride(true);
  const db = new FakeDb(seedEpisodes(35_011));

  const missing = await buildChunkSitemap({ kind: "episodes", page: 15 }, db as any);
  assert.equal(missing.empty, true);
  assert.equal(missing.urls, 0);

  // Through the cache layer, an empty payload is what the route turns into 404.
  const served = await loadSitemap("sitemap:episodes:15", async () => missing, { bypassNextCache: true });
  assert.equal(served.payload.empty, true);
});

test("the route answers 404 for an empty cached chunk and 503 when nothing is cached", async () => {
  // Seed the in-process cache with an empty chunk under the route's key.
  await loadSitemap(
    "sitemap:episodes:15",
    async () => ({ body: "<urlset/>", urls: 0, lastModified: null, empty: true }),
    { bypassNextCache: true },
  );
  const cached = await chunkRoute(new Request("http://localhost/sitemaps/episodes-15.xml"), {
    params: { file: "episodes-15.xml" },
  });
  assert.equal(cached.status, 404);
  assert.equal(cached.headers.get("cache-control"), "no-store", "a 404 must not be cached");
  assertWellFormed(await cached.text(), "the 404 body");

  // No client, nothing cached: 503 + Retry-After, not a 500.
  const outage = await chunkRoute(new Request("http://localhost/sitemaps/episodes-2.xml"), {
    params: { file: "episodes-2.xml" },
  });
  assert.equal(outage.status, 503);
  assert.equal(outage.headers.get("retry-after"), "3600");
  assertWellFormed(await outage.text(), "the 503 body");

  const index = await indexRoute(new Request("http://localhost/sitemap.xml"));
  assert.ok([200, 503].includes(index.status), "the index never 500s");
  assertWellFormed(await index.text(), "the index body");

  const staticFile = await staticRoute(new Request("http://localhost/sitemaps/static.xml"));
  assert.equal(staticFile.status, 200);
  assertWellFormed(await staticFile.text(), "static.xml");
});

test("a failed rebuild serves the last cached copy instead of an error", async () => {
  const key = "sitemap:episodes:1";
  const good = await loadSitemap(
    key,
    async () => ({ body: "<urlset>good</urlset>", urls: 1, lastModified: null, empty: false }),
    { bypassNextCache: true },
  );
  // Age the entry past the TTL so the next request tries to rebuild.
  memorySitemapEntry(key)!.storedAt = Date.now() - SITEMAP_MEMORY_TTL_MS - 1;

  const served = await loadSitemap(key, async () => {
    throw new Error("canceling statement due to statement timeout");
  });
  assert.equal(served.stale, true, "stale copy served");
  assert.equal(served.payload.body, good.payload.body);
  assert.equal(served.etag, good.etag, "the ETag is unchanged, so crawlers keep their copy");
});

// ------------------------------------------------------- caching behaviour

test("concurrent crawler hits build a file once (single-flight)", async () => {
  clearSitemapMemoryCache();
  let builds = 0;
  const builder = async () => {
    builds += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { body: "<urlset/>", urls: 0, lastModified: null, empty: false };
  };

  await Promise.all(Array.from({ length: 8 }, () => loadSitemap("sitemap:anime:1", builder, { bypassNextCache: true })));
  assert.equal(builds, 1, "eight requests, one database walk");

  const cachedHit = await loadSitemap("sitemap:anime:1", builder, { bypassNextCache: true });
  assert.equal(cachedHit.built, false, "the second request is a hit");
  assert.equal(builds, 1);
});

test("responses carry a stable ETag, Last-Modified and the Cloudflare cache rule header", async () => {
  const payload = { body: "<urlset/>", urls: 0, lastModified: "2026-11-11T09:00:00.000Z", empty: false };
  const served = { payload, etag: '"abc123"' };

  const response = sitemapHttpResult(served, new Request("https://kumoritv.top/sitemaps/anime-1.xml"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), SITEMAP_CACHE_CONTROL);
  assert.match(SITEMAP_CACHE_CONTROL, /s-maxage=3600/);
  assert.match(SITEMAP_CACHE_CONTROL, /stale-while-revalidate=86400/);
  assert.equal(response.headers.get("etag"), '"abc123"');
  assert.equal(response.headers.get("last-modified"), new Date("2026-11-11T09:00:00.000Z").toUTCString());

  // Conditional request: the crawler already has this copy.
  const revalidated = sitemapHttpResult(
    served,
    new Request("https://kumoritv.top/sitemaps/anime-1.xml", { headers: { "if-none-match": '"abc123"' } }),
  );
  assert.equal(revalidated.status, 304);

  // A stale serve is still a cacheable 200, labelled for the logs.
  const stale = sitemapHttpResult({ ...served, stale: true }, new Request("https://kumoritv.top/x.xml"));
  assert.equal(stale.headers.get("x-sitemap-cache"), "stale");
});

test("the 503/404 bodies are tiny valid XML, not an HTML error page", async () => {
  const notFound = sitemapErrorResponse(404, "No rows <for> this & chunk");
  assert.equal(notFound.status, 404);
  const body = await notFound.text();
  assertWellFormed(body, "error body");
  assert.match(body, /No rows &lt;for&gt; this &amp; chunk/, "escaped, so a parser cannot break");
});

// ------------------------------------------------- XML validity and limits

test("every produced file is well-formed XML with escaped URLs", async () => {
  setRankedViewAvailableOverride(true);
  const db = new FakeDb(seedEpisodes(25_500));

  const files = ["static.xml", "new.xml", "episodes-1.xml", "episodes-2.xml", "anime-1.xml", "sitemap.xml"];
  for (const name of files) {
    const parsed = parseSitemapFileName(name);
    const payload = parsed
      ? await buildChunkSitemap(parsed, db as any)
      : name === "static.xml"
        ? await import("../../lib/sitemap").then((mod) => mod.buildStaticSitemapPayload())
        : name === "new.xml"
          ? await import("../../lib/sitemap").then((mod) => mod.buildRecentSitemapPayload(db as any))
          : await buildSitemapIndexPayload(db as any);

    assertWellFormed(payload.body, name);
    assert.match(payload.body, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    assert.match(payload.body, /xml-stylesheet/, "the XSL header stays");
  }

  // Escaping: a & or < in anything written into a loc must not break the file.
  assert.equal(xmlEscape("a&b<c>\"d'"), "a&amp;b&lt;c&gt;&quot;d&apos;");
});

test("each file stays inside the 50,000-URL / 50 MB limits, and a breach is loud", async () => {
  setRankedViewAvailableOverride(true);
  const db = new FakeDb(seedEpisodes(12_000));

  const chunk = await buildChunkSitemap({ kind: "episodes", page: 1 }, db as any);
  assert.equal(chunk.urls, 10_000);
  assert.ok(chunk.urls < SITEMAP_MAX_URLS_PER_FILE);

  // A generated file that somehow exceeded the protocol limit is refused rather
  // than served: this is the assertion that keeps CHUNK_SIZE honest.
  assert.throws(
    () =>
      assertSitemapWithinLimits("oversized", {
        body: "<urlset/>",
        urls: SITEMAP_MAX_URLS_PER_FILE + 1,
        lastModified: null,
        empty: false,
      }),
    /limit 50000/,
  );
});

test("the file list the health check walks matches the index", async () => {
  setRankedViewAvailableOverride(true);
  const db = new FakeDb(seedEpisodes(35_011, 25_000));

  const files = await sitemapFileList(db as any);
  assert.equal(files[0], "sitemap.xml");
  assert.ok(files.includes("static.xml") && files.includes("new.xml"));
  assert.deepEqual(
    files.filter((file) => file.startsWith("episodes-")),
    ["episodes-1.xml", "episodes-2.xml", "episodes-3.xml", "episodes-4.xml"],
  );
  assert.equal(files.filter((file) => file.startsWith("anime-")).length, chunkCountFor(25_000));

  // No duplicated or invented chunk numbers.
  assert.equal(new Set(files).size, files.length);
  assert.equal(sitemapIndexFiles(25_000, 35_011).length, files.length - 1, "index entries === children");
});
