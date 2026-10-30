// Prompt 18 / Part 2: sitemap routes, static pages and new.xml.
//
// 404 bug under test: `app/sitemaps/episodes-[n].xml/route.ts` is a LITERAL folder
// name (the App Router only treats a whole segment as dynamic), so
// /sitemaps/episodes-1.xml never matched and production returned 404. Everything
// is served by `app/sitemaps/[file]/route.ts` now, which parses the name itself.

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  CHUNK_SIZE,
  RECENT_EPISODE_LIMIT,
  RECENT_WINDOW_HOURS,
  SITEMAP_FILE_PATTERN,
  STATIC_SITEMAP_PAGES,
  buildEpisodesSitemap,
  buildRecentSitemap,
  buildStaticSitemap,
  countRows,
  fetchEpisodeSlice,
  fetchRecentEpisodes,
  parseSitemapEpisode,
  parseSitemapFileName,
  sitemapIndexFiles,
} from "../../lib/sitemap";
import { GET as chunkRoute } from "@/app/sitemaps/[file]/route";
import { GET as staticRoute } from "@/app/sitemaps/static.xml/route";

const root = process.cwd();

type Row = Record<string, any>;

/**
 * Supabase/PostgREST hands back at most 1000 rows per request whatever range is
 * asked for. This fake enforces exactly that, so a single oversized range shows up
 * as a truncated result instead of passing silently.
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
  private wantsCount = false;
  private headOnly = false;
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private conditions: Array<{ column: string; op: "eq" | "gte"; value: any }> = [];
  private rangeFrom = 0;
  private rangeTo = Number.MAX_SAFE_INTEGER;
  private limitCount: number | null = null;

  constructor(private db: CappedDb, private table: string) {}

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
          : row[condition.column] != null && String(row[condition.column]) >= String(condition.value),
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
    const count = this.wantsCount ? matching.length : null;
    if (this.headOnly) return { data: null, error: null, count };

    let to = this.rangeTo;
    if (this.limitCount !== null) to = Math.min(to, this.rangeFrom + this.limitCount - 1);
    // The server cap.
    to = Math.min(to, this.rangeFrom + this.db.cap - 1);

    const slice = matching.slice(this.rangeFrom, Math.max(this.rangeFrom, to) + 1);
    this.db.requests.push({ table: this.table, from: this.rangeFrom, to, returned: slice.length });
    return { data: slice, error: null, count };
  }

  then<T1 = { data: any; error: any; count: number | null }, T2 = never>(
    onFulfilled?: ((value: { data: any; error: any; count: number | null }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();

const episodeRow = (anilistId: number, episode: number, airDate: string | null, updatedAt = airDate): Row => ({
  anilist_id: anilistId,
  episode_number: episode,
  air_date: airDate,
  updated_at: updatedAt,
});

// --------------------------------------------------------------- file parsing

test("episodes-N.xml and anime-N.xml parse; everything else is a 404", () => {
  assert.deepEqual(parseSitemapFileName("episodes-3.xml"), { kind: "episodes", page: 3 });
  assert.deepEqual(parseSitemapFileName("anime-1.xml"), { kind: "anime", page: 1 });
  assert.deepEqual(parseSitemapFileName("anime-42.xml"), { kind: "anime", page: 42 });

  for (const invalid of [
    "episodes-0.xml",
    "anime-0.xml",
    "episodes-.xml",
    "episodes-1",
    "episodes-1.xml.bak",
    "anime-1.XML",
    "sitemap-episodes-1.xml",
    "episodes-1-2.xml",
    "manga-1.xml",
    "new.xml",
    "static.xml",
    "../etc/passwd",
    "",
  ]) {
    assert.equal(parseSitemapFileName(invalid), null, `${invalid || "(empty)"} is not a sitemap chunk`);
  }

  assert.equal(SITEMAP_FILE_PATTERN.test("episodes-10.xml"), true);
  assert.equal(SITEMAP_FILE_PATTERN.test("anime-10.xml"), true);
});

test("the [file] route 404s on an unknown name and 200s on a real one", async () => {
  const missing = await chunkRoute(new Request("http://localhost/sitemaps/nope.xml"), { params: { file: "nope.xml" } });
  assert.equal(missing.status, 404, "an unknown sitemap name is a 404");

  const traversal = await chunkRoute(new Request("http://localhost/sitemaps/x"), { params: { file: "..%2Fsecret" } });
  assert.equal(traversal.status, 404, "path tricks are a 404");

  // No Supabase env in tests, so the db is null and the builder emits an empty
  // (but valid) urlset: the point is that the route RESOLVES instead of 404ing.
  for (const file of ["episodes-1.xml", "anime-1.xml"]) {
    const response = await chunkRoute(new Request(`http://localhost/sitemaps/${file}`), { params: { file } });
    assert.equal(response.status, 200, `${file} resolves`);
    const body = await response.text();
    assert.match(body, /^<\?xml/);
    assert.match(body, /<urlset/);
    assert.match(String(response.headers.get("cache-control")), /s-maxage=3600/, "chunk files stay cached");
  }
});

test("the old literal folders are gone and every index URL has a route", () => {
  assert.equal(fs.existsSync(path.join(root, "app/sitemaps/episodes-[n].xml")), false, "episodes-[n].xml is deleted");
  assert.equal(fs.existsSync(path.join(root, "app/sitemaps/anime-[n].xml")), false, "anime-[n].xml is deleted");
  assert.ok(fs.existsSync(path.join(root, "app/sitemaps/[file]/route.ts")), "one dynamic route serves the chunks");
  assert.ok(fs.existsSync(path.join(root, "app/sitemaps/new.xml/route.ts")), "new.xml keeps its own folder");
  assert.ok(fs.existsSync(path.join(root, "app/sitemaps/static.xml/route.ts")), "static.xml has its own folder");

  const files = sitemapIndexFiles(25000, 30000).map((file) => file.loc.replace(/^https?:\/\/[^/]+/, ""));

  for (const loc of files) {
    const name = loc.replace("/sitemaps/", "");
    const served =
      name === "new.xml" || name === "static.xml"
        ? fs.existsSync(path.join(root, "app/sitemaps", name, "route.ts"))
        : parseSitemapFileName(name) !== null && fs.existsSync(path.join(root, "app/sitemaps/[file]/route.ts"));
    assert.ok(served, `${loc} is handled by a real route`);
  }
});

// -------------------------------------------------------------- sitemap index

test("the index lists static.xml first, then new.xml, then the right chunk counts", () => {
  const files = sitemapIndexFiles(25000, 30000).map((file) => file.loc.replace(/^https?:\/\/[^/]+/, ""));

  assert.equal(files[0], "/sitemaps/static.xml", "static.xml comes first");
  assert.equal(files[1], "/sitemaps/new.xml", "then new.xml");
  assert.equal(files.filter((loc) => loc.includes("/anime-")).length, Math.ceil(25000 / CHUNK_SIZE));
  assert.equal(files.filter((loc) => loc.includes("/episodes-")).length, Math.ceil(30000 / CHUNK_SIZE));
  assert.equal(CHUNK_SIZE, 10000, "the chunk size is the same constant the files read");

  assert.deepEqual(files.slice(2, 4), ["/sitemaps/anime-1.xml", "/sitemaps/anime-2.xml"]);
  assert.ok(files.includes("/sitemaps/episodes-3.xml"));

  // Counts are exact (a head request), not capped at 1000.
  const db = new CappedDb({
    anime: Array.from({ length: 20001 }, (_, index) => ({ anilist_id: index + 1 })),
    sitemap_episodes: Array.from({ length: 10001 }, (_, index) => episodeRow(index + 1, 1, hoursAgo(1))),
  });

  return Promise.all([countRows(db as never, "anime"), countRows(db as never, "sitemap_episodes")]).then(
    ([anime, episodes]) => {
      const locs = sitemapIndexFiles(anime, episodes).map((file) => file.loc);
      assert.equal(locs.filter((loc) => loc.includes("/anime-")).length, 3);
      assert.equal(locs.filter((loc) => loc.includes("/episodes-")).length, 2);
    },
  );
});

// ----------------------------------------------------------------- static.xml

test("static.xml lists only the indexable static pages that exist", async () => {
  const response = await staticRoute();
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /<loc>https:\/\/kumoritv\.top\/<\/loc>/, "the home page");
  assert.match(body, /<priority>1\.0<\/priority>/);
  assert.match(body, /<changefreq>daily<\/changefreq>/);
  assert.match(body, /<loc>https:\/\/kumoritv\.top\/search<\/loc>/, "the search page");
  assert.match(body, /\/search\?type=manga/, "the manga catalogue");

  // Never list a noindex or private page.
  for (const absent of ["/privacy", "/terms", "/favourites", "/my-lists", "/auth", "/api/"]) {
    assert.equal(body.includes(absent), false, `${absent} is not in static.xml`);
  }

  // Every listed page really exists in app/.
  for (const page of STATIC_SITEMAP_PAGES) {
    const route = page.path.split("?")[0]!;
    const file = path.join(root, "app", route === "/" ? "" : route.slice(1), "page.tsx");
    assert.ok(fs.existsSync(file), `${page.path} exists at ${path.relative(root, file)}`);
  }

  // ...and the legal pages really are noindex, which is why they are excluded.
  for (const legal of ["app/privacy/page.tsx", "app/terms/page.tsx"]) {
    assert.match(fs.readFileSync(path.join(root, legal), "utf8"), /index:\s*false/, `${legal} is noindex`);
  }
});

test("robots.txt disallows nothing that the sitemaps list", async () => {
  const robots = (await import("@/app/robots")).default();
  const disallow = (Array.isArray(robots.rules.disallow) ? robots.rules.disallow : [robots.rules.disallow]) as string[];

  const listed = [
    ...STATIC_SITEMAP_PAGES.map((page) => page.path),
    "/sitemaps/static.xml",
    "/sitemaps/new.xml",
    "/sitemaps/anime-1.xml",
    "/sitemaps/episodes-1.xml",
  ];

  for (const url of listed) {
    for (const blocked of disallow) {
      const prefix = blocked.replace(/\*$/, "");
      assert.equal(url.startsWith(prefix), false, `${url} must not be disallowed by ${blocked}`);
    }
  }
});

// -------------------------------------------------------------------- new.xml

test("new.xml reads the 72h air_date window, newest first, capped at 2000", async () => {
  assert.equal(RECENT_WINDOW_HOURS, 72);
  assert.equal(RECENT_EPISODE_LIMIT, 2000);

  const newest = hoursAgo(1);

  const rows: Row[] = [
    // Old episode that a bulk import "touched" recently: air_date keeps it out.
    episodeRow(999, 1, hoursAgo(72 * 30), hoursAgo(0.1)),
    // Inside the window, deliberately shuffled by updated_at.
    episodeRow(3, 1, newest, hoursAgo(90)),
    episodeRow(1, 5, hoursAgo(40), hoursAgo(0.2)),
    episodeRow(2, 2, hoursAgo(71), hoursAgo(5)),
    // Outside the window.
    episodeRow(4, 1, hoursAgo(73)),
  ];

  const db = new CappedDb({ sitemap_episodes: rows });
  const recent = await fetchRecentEpisodes(db as never, RECENT_WINDOW_HOURS);

  assert.deepEqual(
    recent.map((row) => `${row.anilist_id}-${row.episode_number}`),
    ["3-1", "1-5", "2-2"],
    "72h window on air_date, newest air_date first",
  );
  assert.equal(recent.some((row) => row.anilist_id === 999), false, "a re-synced old episode is not 'new'");

  const xml = buildRecentSitemap(recent, []);
  const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => match[1]!);
  assert.equal(lastmods[0], newest, "lastmod is the air date, not updated_at");
  assert.ok(xml.indexOf("ep=1") < xml.indexOf("ep=5"), "newest first");
});

test("new.xml pages at 1000 rows and stops at the 2000 cap", async () => {
  const total = RECENT_EPISODE_LIMIT + 700;
  const db = new CappedDb({
    sitemap_episodes: Array.from({ length: total }, (_, index) =>
      // Descending air dates so the order is deterministic.
      episodeRow(index + 1, 1, new Date(Date.now() - index * 1000).toISOString()),
    ),
  });

  const recent = await fetchRecentEpisodes(db as never, RECENT_WINDOW_HOURS);

  assert.equal(recent.length, RECENT_EPISODE_LIMIT, "never more than 2000 rows");

  const first = recent.slice(0, 1000).map((row) => row.anilist_id);
  const second = recent.slice(1000).map((row) => row.anilist_id);

  assert.equal(first[0], 1);
  assert.equal(first[999], 1000);
  assert.equal(second[0], 1001, "the second page continues exactly where the first ended");
  assert.equal(new Set([...first, ...second]).size, 2000, "no repeats across pages");

  assert.equal(db.requests.length, 2, "two 1000-row pages");
  for (const request of db.requests) {
    assert.ok(request.returned <= 1000, "the server cap was respected");
    assert.ok(request.to - request.from + 1 <= 1000, "one page per request");
  }
});

test("a bulk-written row with no air_date is never treated as just-aired", async () => {
  const db = new CappedDb({
    sitemap_episodes: [episodeRow(1, 1, null, hoursAgo(1)), episodeRow(2, 1, hoursAgo(2))],
  });

  const recent = await fetchRecentEpisodes(db as never, RECENT_WINDOW_HOURS);
  assert.deepEqual(recent.map((row) => row.anilist_id), [2], "no air_date means not in the window");
});

// --------------------------------------------------------------- no inventions

test("episodes chunks list only rows the view actually has", async () => {
  const db = new CappedDb({
    // Gaps on purpose: episodes 2, 3 and 4 do not exist.
    sitemap_episodes: [episodeRow(100, 1, hoursAgo(10)), episodeRow(100, 5, hoursAgo(9)), episodeRow(100, 9, hoursAgo(8))],
  });

  const rows = await fetchEpisodeSlice(db as never, 1);
  const xml = buildEpisodesSitemap(rows);

  const episodes = [...xml.matchAll(/ep=(\d+)/g)].map((match) => Number(match[1]));
  assert.deepEqual(episodes, [1, 5, 9], "no 1..N generation");

  // Malformed view rows are dropped, never guessed.
  assert.equal(parseSitemapEpisode({ anilist_id: 1, episode_number: 0 }), null);
  assert.equal(parseSitemapEpisode({ anilist_id: 1, episode_number: "2.5" }), null);
  assert.equal(parseSitemapEpisode({ anilist_id: -3, episode_number: 1 }), null);
  assert.equal(parseSitemapEpisode({ anilist_id: null, episode_number: null }), null);
  assert.deepEqual(parseSitemapEpisode({ anilist_id: "7", episode_number: "2", air_date: hoursAgo(1) }), {
    anilist_id: 7,
    episode_number: 2,
    updated_at: null,
    air_date: hoursAgo(1),
  });
});

test("new.xml keeps the media-URL-only rule for not-yet-imported episodes", () => {
  const viewRows = [
    { anilist_id: 10, episode_number: 1, updated_at: hoursAgo(3), air_date: hoursAgo(3) },
  ];
  const topUp = [
    { media: { id: 10 }, episode: 1, airingAt: Math.floor(Date.now() / 1000) - 60 }, // already known
    { media: { id: 11 }, episode: 4, airingAt: Math.floor(Date.now() / 1000) - 60 }, // not imported
    { media: { id: 12 }, episode: 2, airingAt: Math.floor(Date.now() / 1000) + 600 }, // has not aired
    { media: { id: 11 }, episode: 5, airingAt: Math.floor(Date.now() / 1000) - 60 }, // same show, one media URL
  ];

  const xml = buildRecentSitemap(viewRows as never, topUp);

  assert.match(xml, /\/watch\/10\?ep=1/, "the playable episode gets a watch URL");
  assert.equal(xml.includes("/watch/11"), false, "an unimported episode gets no watch URL");
  assert.equal(xml.split("/media/11<").length - 1, 1, "one media URL per show");
  assert.equal(xml.includes("/media/12"), false, "a future episode is not listed");
});
