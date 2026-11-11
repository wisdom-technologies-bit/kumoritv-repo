import { createAdminClient } from "@/app/lib/supabase/admin";
import type { SitemapPayload } from "@/lib/sitemap-cache";
import { fetchAiringWindow } from "@/app/lib/discovery/anilist";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://kumoritv.top").replace(/\/$/, "");
export const CHUNK_SIZE = 10000;
/**
 * PostgREST never returns more than 1000 rows per request, whatever `range` or
 * `limit` asks for. Every multi-row read below pages in steps of this size
 * (same fix as `selectAllEpisodeRows` in app/lib/anime-db/queries.ts).
 */
export const ROW_PAGE_SIZE = 1000;
/** Hard cap on the AniList top-up rows a single new.xml request will consider. */
export const RECENT_TOPUP_LIMIT = 2000;
/** Hard cap on view rows read for new.xml (72h window), paged at 1000. */
export const RECENT_EPISODE_LIMIT = 2000;
/** new.xml window: what actually aired in the last 72 hours. */
export const RECENT_WINDOW_HOURS = 72;

/**
 * The only file names /sitemaps/[file] will serve. Next.js App Router folders are
 * whole path segments, so `episodes-[n].xml` can never be dynamic: one catch-all
 * route parses these instead.
 */
export const SITEMAP_FILE_PATTERN = /^(episodes|anime)-(\d+)\.xml$/;

export type SitemapFile =
  | { kind: "episodes"; page: number }
  | { kind: "anime"; page: number };

/** `episodes-3.xml` / `anime-1.xml` -> parsed; anything else -> null (404). */
export function parseSitemapFileName(file: string | undefined | null): SitemapFile | null {
  const name = String(file ?? "");
  const match = SITEMAP_FILE_PATTERN.exec(name);
  if (!match) return null;
  const page = Number(match[2]);
  if (!Number.isInteger(page) || page < 1) return null;
  return { kind: match[1] as "episodes" | "anime", page };
}

/**
 * The episodes sitemap is driven by the `public.sitemap_episodes` view:
 * one row per episode that exists in `episodes` with at least one sub or dub
 * provider AND whose anime row exists. We never invent episode numbers.
 */
export const SITEMAP_EPISODES_VIEW = "sitemap_episodes";

/**
 * Prompt 34: the ranked MATERIALIZED view (docs/sql/sitemap-chunks.sql).
 *
 * The old view has no storage, so chunk N cost an OFFSET deep into a re-sorted
 * join: ~1.4 s for chunk 1, ~13.7 s past row 40,000, and the slowest reads came
 * back as HTTP 500. `sitemap_episodes_ranked` stores the same rows once with a
 * dense `rn` and a unique index on it, so a chunk is
 * `rn between (N-1)*10000+1 and N*10000`: an index range scan, ~0.2 ms at any
 * depth in the stand-in.
 *
 * The view is created by a SQL file the owner runs by hand, so the code must
 * keep working before it exists: every read below falls back to the old view.
 */
export const SITEMAP_EPISODES_RANKED_VIEW = "sitemap_episodes_ranked";

/** Sitemap protocol ceilings per file. A chunk is CHUNK_SIZE (10,000) today. */
export const SITEMAP_MAX_URLS_PER_FILE = 50000;
export const SITEMAP_MAX_BYTES_PER_FILE = 50 * 1024 * 1024;

export type SitemapEpisode = {
  anilist_id: number;
  episode_number: number;
  updated_at: string | null;
  /** When the episode actually aired. The view exposes it; `updated_at` does not
   *  mean "new" (bulk imports and re-syncs bump it). */
  air_date: string | null;
};

export type SitemapMedia = {
  anilist_id: number;
  updated_at: string | null;
};

export const xmlEscape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export const watchUrl = (id: number, episode: number) => `${SITE_URL}/watch/${id}?ep=${episode}`;
export const mediaUrl = (id: number) => `${SITE_URL}/media/${id}`;
export const xmlResponse = (body: string, seconds: number, type = "application/xml") => new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate` } });
export function sitemapUrl(loc: string, lastmod?: string | null, changefreq?: string, priority?: string) { return `<url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : ""}${changefreq ? `<changefreq>${changefreq}</changefreq>` : ""}${priority ? `<priority>${priority}</priority>` : ""}</url>`; }
export function sitemapDoc(urls: string[]) { return `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`; }
export function indexDoc(files: Array<{ loc: string; lastmod?: string }>) { return `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map((file) => `<sitemap><loc>${xmlEscape(file.loc)}</loc>${file.lastmod ? `<lastmod>${xmlEscape(file.lastmod)}</lastmod>` : ""}</sitemap>`).join("")}</sitemapindex>`; }

/** Supabase-shaped client. The view is not in the generated types, so it is `any`. */
export type SitemapDb = { from: (table: string) => any };

/**
 * PostgREST hands back plain `{ message, details, hint, code }` objects rather
 * than Error instances, so `String(error)` printed "[object Object]" in the log
 * line that is supposed to explain a production sitemap failure.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const candidate = error as { message?: unknown; error?: { message?: unknown }; code?: unknown } | null;
  const message = candidate?.message ?? candidate?.error?.message;
  const code = candidate?.code ?? (candidate?.error as { code?: unknown } | undefined)?.code;
  if (typeof message === "string" && message) return code ? `${message} (code ${String(code)})` : message;
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") return json;
  } catch {
    /* fall through */
  }
  return "unknown error";
}

export function getSitemapDb(): SitemapDb | null {
  return createAdminClient() as unknown as SitemapDb | null;
}

/**
 * Reads `[chunkStart, chunkEnd]` in pages of 1000 rows.
 *
 * PostgREST caps every response at 1000 rows, so a single `.range(0, 39999)`
 * silently returns 1000 rows and the rest of the chunk goes missing. Each page
 * is requested sequentially (no artificial delay) with a stable ORDER BY so the
 * offsets line up, and the walk stops as soon as a short page arrives.
 */
export async function readRowsPaged<T = any>(
  db: SitemapDb | null,
  options: {
    table: string;
    columns: string;
    order: Array<string | { column: string; ascending?: boolean }>;
    chunkStart: number;
    chunkEnd: number;
    filters?: (query: any) => any;
    pageSize?: number;
    limit?: number;
  },
): Promise<T[]> {
  const { table, columns, order, chunkStart, chunkEnd } = options;
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : ROW_PAGE_SIZE;
  const limit = options.limit && options.limit > 0 ? options.limit : Infinity;
  if (!db) return [] as T[];

  const rows: T[] = [];
  const start = Math.max(0, chunkStart);
  const end = Math.max(start, chunkEnd);

  for (let from = start; from <= end; from += pageSize) {
    // Never ask for more than one page: the server would truncate it anyway.
    const to = Math.min(from + pageSize - 1, end);

    let query: any = db.from(table).select(columns);
    if (options.filters) query = options.filters(query);
    for (const entry of order) {
      const column = typeof entry === "string" ? entry : entry.column;
      const ascending = typeof entry === "string" ? true : entry.ascending !== false;
      query = query.order(column, { ascending });
    }
    const paged = typeof query?.range === "function" ? query.range(from, to) : query;

    const { data, error } = await paged;
    if (error) throw error;

    const page = Array.isArray(data) ? (data as T[]) : [];
    rows.push(...page);

    // A short page means the chunk is exhausted; a full one means keep going.
    if (page.length < to - from + 1) break;
    if (rows.length >= limit) break;
  }

  return rows.length > limit ? rows.slice(0, limit) : rows;
}

/** Drops malformed view rows instead of emitting invented episode numbers. */
export function parseSitemapEpisode(row: any): SitemapEpisode | null {
  const id = Number(row?.anilist_id);
  const episode = Number(row?.episode_number);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!Number.isInteger(episode) || episode <= 0) return null;
  return {
    anilist_id: id,
    episode_number: episode,
    updated_at: typeof row?.updated_at === "string" && row.updated_at ? row.updated_at : null,
    air_date: typeof row?.air_date === "string" && row.air_date ? row.air_date : null,
  };
}

export function parseSitemapMedia(row: any): SitemapMedia | null {
  const id = Number(row?.anilist_id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    anilist_id: id,
    updated_at: typeof row?.updated_at === "string" && row.updated_at ? row.updated_at : null,
  };
}

/** Exact row count for the index (head request: no payload). */
export async function countRows(db: SitemapDb | null, table: string): Promise<number> {
  if (!db) return 0;
  const { count, error } = await db.from(table).select("anilist_id", { count: "exact", head: true });
  if (error) throw error;
  return Number(count) || 0;
}

/**
 * Chunk N covers the dense rank range [start, end]:
 *   start = (N - 1) * size + 1, end = N * size.
 * `rn` is 1-based, so `chunkRange(1, 10000) === { start: 1, end: 10000 }` and
 * `chunkRange(4, 10000)` starts at row 30,001.
 */
export function chunkRange(page: number, size = CHUNK_SIZE): { start: number; end: number } {
  const safePage = Math.max(1, Math.floor(Number(page)) || 1);
  const safeSize = Math.max(1, Math.floor(Number(size)) || CHUNK_SIZE);
  return { start: (safePage - 1) * safeSize + 1, end: safePage * safeSize };
}

/** How many files of `size` rows a table of `rows` rows needs. */
export const chunkCountFor = (rows: number, size = CHUNK_SIZE) =>
  Math.max(0, Math.ceil((Number(rows) || 0) / Math.max(1, Math.floor(size) || CHUNK_SIZE)));

const RANKED_PROBE_TTL_MS = 5 * 60 * 1000;
/**
 * The answer is cached per client, not per module: each request builds its own
 * client (and every test builds its own fake), so a module-wide flag would let
 * one client's "the ranked view exists" leak into another's reads.
 */
const rankedProbes = new WeakMap<object, { available: boolean; checkedAt: number }>();
let rankedOverride: boolean | null = null;

/** Test seam: forget the cached "does the ranked view exist" answer. */
export function resetRankedProbe() {
  rankedOverride = null;
  lastGoodEpisodeRows = null;
}

/**
 * Test seam: pretend the ranked view exists (or does not) without a database.
 * `null` restores the real probe.
 */
export function setRankedViewAvailableOverride(value: boolean | null) {
  rankedOverride = value;
}

/**
 * Does `sitemap_episodes_ranked` exist yet? PostgREST answers 42P01 /
 * PGRST205 until the owner runs docs/sql/sitemap-chunks.sql, and the answer is
 * cached for a few minutes so a missing view is not probed on every request.
 */
export async function rankedViewAvailable(db: SitemapDb | null): Promise<boolean> {
  if (rankedOverride !== null) return rankedOverride;
  if (!db) return false;
  const now = Date.now();
  const cached = rankedProbes.get(db as object);
  if (cached && now - cached.checkedAt < RANKED_PROBE_TTL_MS) return cached.available;
  let available = false;
  try {
    // A missing view is an error (42P01 / PGRST205); an existing but empty view
    // returns no rows. Both mean "nothing to read up there", so the fallback is
    // the right answer either way - and treating an empty answer as unavailable
    // keeps a fake client that has no such table from looking like one.
    const { data, error } = await db.from(SITEMAP_EPISODES_RANKED_VIEW).select("rn").limit(1);
    available = !error && Array.isArray(data) && data.length > 0;
  } catch {
    available = false;
  }
  rankedProbes.set(db as object, { available, checkedAt: now });
  return available;
}

/**
 * One chunk (CHUNK_SIZE rows) of playable episodes, ordered by id then episode.
 *
 * Ranked path: `rn between start and end`, paged at PostgREST's 1000-row cap -
 * an index range scan, so chunk 40 costs what chunk 1 costs.
 * Fallback path: the old offset walk over the un-materialised view, unchanged,
 * so deploying before the SQL lands cannot break the sitemaps.
 */
export async function fetchEpisodeSlice(db: SitemapDb | null, page: number, size = CHUNK_SIZE): Promise<SitemapEpisode[]> {
  const { start, end } = chunkRange(page, size);

  if (await rankedViewAvailable(db)) {
    try {
      const ranked = await readRowsPaged<any>(db, {
        table: SITEMAP_EPISODES_RANKED_VIEW,
        columns: "rn,anilist_id,episode_number,updated_at,air_date",
        order: ["rn"],
        // The rn filter below already restricts the rows to this chunk, so the
        // page offsets start at 0: no OFFSET is ever pushed to the database.
        chunkStart: 0,
        chunkEnd: end - start,
        filters: (query: any) =>
          typeof query?.gte === "function" && typeof query?.lte === "function"
            ? query.gte("rn", start).lte("rn", end)
            : query,
      });
      return ranked.map(parseSitemapEpisode).filter((row): row is SitemapEpisode => row !== null);
    } catch (error) {
      // The view is being recreated (SQL editor run) or the read timed out:
      // read the old view for this request instead of failing the sitemap, and
      // stop probing the ranked view for a while.
      console.error(
        `[sitemap] ranked read failed page=${page} rn=${start}-${end} step=read error=${
          formatError(error)
        } - falling back to ${SITEMAP_EPISODES_VIEW}`,
      );
      if (db) rankedProbes.set(db as object, { available: false, checkedAt: Date.now() });
    }
  }

  const from = start - 1;
  const rows = await readRowsPaged<any>(db, {
    table: SITEMAP_EPISODES_VIEW,
    columns: "anilist_id,episode_number,updated_at,air_date",
    order: ["anilist_id", "episode_number"],
    chunkStart: from,
    chunkEnd: end - 1,
  });
  return rows.map(parseSitemapEpisode).filter((row): row is SitemapEpisode => row !== null);
}

/** Total playable episodes: max(rn) on the ranked view (one index step), else count(*). */
export async function episodeRowCount(db: SitemapDb | null, size = CHUNK_SIZE): Promise<number> {
  void size;
  if (await rankedViewAvailable(db)) {
    const { data, error } = await db!
      .from(SITEMAP_EPISODES_RANKED_VIEW)
      .select("rn")
      .order("rn", { ascending: false })
      .limit(1);
    if (error) throw error;
    return Number(data?.[0]?.rn) || 0;
  }
  return countRows(db, SITEMAP_EPISODES_VIEW);
}

let lastGoodEpisodeRows: number | null = null;

/** For the health/cron routes and tests. */
export function peekLastGoodEpisodeRows() {
  return lastGoodEpisodeRows;
}

/**
 * The index's chunk count. `count: 'exact'` on the heavy view is what used to
 * time out and silently list too few (or too many) chunks, so:
 *   - the ranked view answers with max(rn), the same data the chunk route reads;
 *   - a failed read reuses the last successful count instead of dropping chunks;
 *   - the count never shrinks quietly either: a smaller answer is logged.
 */
export async function episodeChunkCountStable(
  db: SitemapDb | null,
  size = CHUNK_SIZE,
): Promise<{ chunks: number; rows: number; source: "ranked" | "view" | "last-good" | "none" }> {
  const ranked = await rankedViewAvailable(db);
  try {
    const rows = await episodeRowCount(db, size);
    if (rows > 0 || lastGoodEpisodeRows === null) {
      if (lastGoodEpisodeRows !== null && rows < lastGoodEpisodeRows) {
        console.warn(
          `[sitemap] episode rows dropped rows=${rows} previous=${lastGoodEpisodeRows} source=${
            ranked ? "ranked" : "view"
          }`,
        );
      }
      lastGoodEpisodeRows = rows;
      return { chunks: chunkCountFor(rows, size), rows, source: ranked ? "ranked" : "view" };
    }
    return { chunks: chunkCountFor(lastGoodEpisodeRows, size), rows: lastGoodEpisodeRows, source: "last-good" };
  } catch (error) {
    console.error(
      `[sitemap] episode count failed step=count source=${ranked ? "ranked" : "view"} error=${
        formatError(error)
      }`,
    );
    if (lastGoodEpisodeRows !== null) {
      return { chunks: chunkCountFor(lastGoodEpisodeRows, size), rows: lastGoodEpisodeRows, source: "last-good" };
    }
    return { chunks: 0, rows: 0, source: "none" };
  }
}

/** max(updated_at) of one episode chunk, for the index's <lastmod>. Null when unknown. */
export async function episodeChunkLastmod(db: SitemapDb | null, page: number, size = CHUNK_SIZE): Promise<string | null> {
  if (!(await rankedViewAvailable(db))) return null;
  const { start, end } = chunkRange(page, size);
  try {
    const { data, error } = await db!
      .from(SITEMAP_EPISODES_RANKED_VIEW)
      .select("updated_at")
      .gte("rn", start)
      .lte("rn", end)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) return null;
    const value = data?.[0]?.updated_at;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/** One chunk of imported anime (media pages). */
export async function fetchMediaSlice(db: SitemapDb | null, page: number, size = CHUNK_SIZE): Promise<SitemapMedia[]> {
  const from = (Math.max(1, page) - 1) * size;
  const rows = await readRowsPaged<any>(db, {
    table: "anime",
    columns: "anilist_id,updated_at",
    order: ["anilist_id"],
    chunkStart: from,
    chunkEnd: from + size - 1,
  });
  return rows.map(parseSitemapMedia).filter((row): row is SitemapMedia => row !== null);
}

/**
 * new.xml: what actually aired in the last `hours` (72 by default).
 *
 * Ordered by `air_date` DESC (newest first) with the (anilist_id, episode_number)
 * tie-breaker so the 1000-row page offsets stay stable, capped at
 * RECENT_EPISODE_LIMIT rows. `air_date` - not `updated_at` - is the window key:
 * bulk imports and re-syncs bump `updated_at` on old episodes, which used to put
 * ancient episodes at the top of the file.
 */
export async function fetchRecentEpisodes(db: SitemapDb | null, hours = RECENT_WINDOW_HOURS): Promise<SitemapEpisode[]> {
  if (!db) return [] as SitemapEpisode[];
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = await readRowsPaged<any>(db, {
    table: SITEMAP_EPISODES_VIEW,
    columns: "anilist_id,episode_number,updated_at,air_date",
    order: [
      { column: "air_date", ascending: false },
      { column: "anilist_id", ascending: true },
      { column: "episode_number", ascending: true },
    ],
    chunkStart: 0,
    // Read up to the cap and stop: new.xml never needs more than this.
    chunkEnd: RECENT_EPISODE_LIMIT - 1,
    limit: RECENT_EPISODE_LIMIT,
    pageSize: ROW_PAGE_SIZE,
    filters: (query: any) => (typeof query?.gte === "function" ? query.gte("air_date", since) : query),
  });
  return rows
    .map(parseSitemapEpisode)
    .filter((row): row is SitemapEpisode => row !== null)
    // Belt and braces: the query already filters on air_date, but the window must
    // hold even for a client that cannot express it. A row with no air_date is by
    // definition not "just aired", so it never belongs in new.xml.
    .filter((row) => Boolean(row.air_date) && String(row.air_date) >= since);
}

// ------------------------------------------------------------------ builders

export function buildEpisodesSitemap(rows: SitemapEpisode[]): string {
  return sitemapDoc(rows.map((row) => sitemapUrl(watchUrl(row.anilist_id, row.episode_number), row.updated_at)));
}

export function buildMediaSitemap(rows: SitemapMedia[]): string {
  return sitemapDoc(rows.map((row) => sitemapUrl(mediaUrl(row.anilist_id), row.updated_at, undefined, "0.7")));
}

/**
 * new.xml: recently aired episodes. A watch URL is only emitted when the view
 * has that exact (anilist_id, episode) pair. A just-aired episode we have not
 * imported yet contributes only its media URL, so Google never crawls a watch
 * page with no video.
 */
export function buildRecentSitemap(episodes: SitemapEpisode[], topUp: any[]): string {
  const known = new Map<string, SitemapEpisode>();
  for (const row of episodes) known.set(`${row.anilist_id}-${row.episode_number}`, row);

  const urls: string[] = [];
  const emittedMedia = new Set<number>();

  for (const row of known.values()) {
    // lastmod is the air date when the view has one: updated_at moves on every
    // re-sync and would tell Google an old episode just changed.
    const lastmod = row.air_date || row.updated_at;
    urls.push(sitemapUrl(watchUrl(row.anilist_id, row.episode_number), lastmod, "always", "0.9"));
    if (!emittedMedia.has(row.anilist_id)) {
      emittedMedia.add(row.anilist_id);
      urls.push(sitemapUrl(mediaUrl(row.anilist_id), lastmod));
    }
  }

  const nowSeconds = Date.now() / 1000;
  let seen = 0;

  for (const item of topUp) {
    if (seen >= RECENT_TOPUP_LIMIT) break;
    const id = Number(item?.media?.id ?? item?.anilist_id);
    const episode = Number(item?.episode ?? item?.episode_number);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(episode) || episode <= 0) continue;
    if (typeof item?.airingAt === "number" && item.airingAt > nowSeconds) continue;
    seen += 1;

    const key = `${id}-${episode}`;
    if (known.has(key)) continue;

    // Not imported (or not playable): media page only.
    if (emittedMedia.has(id)) continue;
    emittedMedia.add(id);
    const airedAt = typeof item?.airingAt === "number" ? new Date(item.airingAt * 1000).toISOString() : null;
    urls.push(sitemapUrl(mediaUrl(id), airedAt));
  }

  return sitemapDoc(urls);
}

/**
 * The fixed, public, indexable pages of the site.
 *
 * Only pages that exist in app/ AND are indexable are listed. Deliberately
 * absent: /privacy and /terms (their page metadata is `robots: { index: false }`
 * because the wording is region-sensitive, and a sitemap must never advertise a
 * noindex URL), /favourites and /my-lists (behind a session), /auth and /api/*
 * (never crawled), and the dynamic /media/[id], /watch/[id], /read/[id] pages
 * (served by the anime-* and episodes-* chunks).
 */
export const STATIC_SITEMAP_PAGES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  // Prompt 33: the release schedule changes every few minutes, so it is a
  // daily-crawl page in its own right.
  { path: "/schedule", changefreq: "daily", priority: "0.8" },
  { path: "/search", changefreq: "daily", priority: "0.8" },
  { path: "/search?type=manga", changefreq: "daily", priority: "0.7" },
];

export function buildStaticSitemap(pages = STATIC_SITEMAP_PAGES): string {
  return sitemapDoc(pages.map((page) => sitemapUrl(`${SITE_URL}${page.path}`, null, page.changefreq, page.priority)));
}

/**
 * The index lists exactly as many chunks as the chunk routes can serve:
 * N = ceil(count / CHUNK_SIZE) from the same constant the files read, and the
 * counts come from the same source each file pages through (anime table for
 * anime-*, the sitemap_episodes view for episodes-*).
 */
export function sitemapIndexFiles(
  animeCount: number,
  episodeCount: number,
  lastmods: { anime?: Record<number, string | null>; episodes?: Record<number, string | null> } = {},
): Array<{ loc: string; lastmod?: string }> {
  const chunksFor = (count: number) => Math.max(0, Math.ceil((Number(count) || 0) / CHUNK_SIZE));
  const withLastmod = (loc: string, lastmod?: string | null) =>
    lastmod ? { loc, lastmod } : { loc };
  return [
    { loc: `${SITE_URL}/sitemaps/static.xml` },
    { loc: `${SITE_URL}/sitemaps/new.xml` },
    ...Array.from({ length: chunksFor(animeCount) }, (_, index) =>
      withLastmod(`${SITE_URL}/sitemaps/anime-${index + 1}.xml`, lastmods.anime?.[index + 1]),
    ),
    ...Array.from({ length: chunksFor(episodeCount) }, (_, index) =>
      withLastmod(`${SITE_URL}/sitemaps/episodes-${index + 1}.xml`, lastmods.episodes?.[index + 1]),
    ),
  ];
}

export async function recentAiringTopUp() {
  try { const page = await fetchAiringWindow(Math.floor(Date.now() / 1000) - 21600, Math.floor(Date.now() / 1000), 1); return (page.airingSchedules || []).filter((item: any) => item.airingAt <= Date.now() / 1000); } catch { return []; }
}
export const chunks = <T,>(items: T[], size = CHUNK_SIZE) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/* -------------------------------------------------------------------------- */
/* Prompt 34 Part B: one payload per sitemap file, with its own cache + limits */
/* -------------------------------------------------------------------------- */


/**
 * The limits every produced file is checked against before it is cached or
 * served: 50,000 URLs and 50 MB per file. A chunk is 10,000 URLs today, so a
 * breach means CHUNK_SIZE or the row mapping changed, not that Google is wrong.
 */
export function assertSitemapWithinLimits(label: string, payload: SitemapPayload): SitemapPayload {
  const bytes = Buffer.byteLength(payload.body, "utf8");
  if (payload.urls > SITEMAP_MAX_URLS_PER_FILE) {
    throw new Error(`sitemap ${label} has ${payload.urls} URLs (limit ${SITEMAP_MAX_URLS_PER_FILE})`);
  }
  if (bytes > SITEMAP_MAX_BYTES_PER_FILE) {
    throw new Error(`sitemap ${label} is ${bytes} bytes (limit ${SITEMAP_MAX_BYTES_PER_FILE})`);
  }
  return payload;
}

/** /sitemaps/episodes-N.xml and /sitemaps/anime-N.xml. */
export async function buildChunkSitemap(
  file: SitemapFile,
  db: SitemapDb | null = getSitemapDb(),
): Promise<SitemapPayload> {
  // No client means we cannot know whether the chunk is empty: that is an
  // outage (503), never an empty file (404).
  if (!db) throw new Error("supabase admin client unavailable");

  if (file.kind === "episodes") {
    const episodes = await fetchEpisodeSlice(db, file.page);
    const lastModified = episodes.length ? await episodeChunkLastmod(db, file.page) : null;
    return assertSitemapWithinLimits(`episodes-${file.page}`, {
      body: buildEpisodesSitemap(episodes),
      urls: episodes.length,
      lastModified: lastModified ?? (episodes[0]?.updated_at ?? null),
      empty: episodes.length === 0,
    });
  }

  const media = await fetchMediaSlice(db, file.page);
  return assertSitemapWithinLimits(`anime-${file.page}`, {
    body: buildMediaSitemap(media),
    urls: media.length,
    lastModified: media[0]?.updated_at ?? null,
    empty: media.length === 0,
  });
}

/** /sitemap.xml - lists exactly the chunks that have rows, with per-chunk lastmod. */
export async function buildSitemapIndexPayload(
  db: SitemapDb | null = getSitemapDb(),
): Promise<SitemapPayload> {
  const [{ chunks: episodeChunks }, animeRows] = await Promise.all([
    episodeChunkCountStable(db),
    countRows(db, "anime").catch((error) => {
      console.error(`[sitemap] anime count failed step=count error=${formatError(error)}`);
      return 0;
    }),
  ]);

  const lastmods: { episodes?: Record<number, string | null>; anime?: Record<number, string | null> } = {};
  const episodePages = Array.from({ length: episodeChunks }, (_, index) => index + 1);
  const settled = await Promise.all(
    episodePages.map((page) => episodeChunkLastmod(db, page).catch(() => null)),
  );
  if (settled.some(Boolean)) {
    lastmods.episodes = Object.fromEntries(episodePages.map((page, index) => [page, settled[index]]));
  }

  const files = sitemapIndexFiles(animeRows, episodeChunks * CHUNK_SIZE, lastmods);
  return assertSitemapWithinLimits("index", {
    body: indexDoc(files),
    urls: files.length,
    lastModified: settled.find(Boolean) ?? null,
    empty: files.length === 0,
  });
}

/** /sitemaps/new.xml */
export async function buildRecentSitemapPayload(
  db: SitemapDb | null = getSitemapDb(),
): Promise<SitemapPayload> {
  const [episodes, topUp] = await Promise.all([
    fetchRecentEpisodes(db, RECENT_WINDOW_HOURS).catch((error) => {
      console.error(`[sitemap] new.xml rows failed step=recent error=${formatError(error)}`);
      return [] as SitemapEpisode[];
    }),
    recentAiringTopUp(),
  ]);
  const body = buildRecentSitemap(episodes, topUp);
  return assertSitemapWithinLimits("new", {
    body,
    urls: (body.match(/<url>/g) || []).length,
    lastModified: episodes[0]?.air_date ?? null,
    empty: false,
  });
}

/** /sitemaps/static.xml */
export function buildStaticSitemapPayload(): SitemapPayload {
  const body = buildStaticSitemap(STATIC_SITEMAP_PAGES);
  return assertSitemapWithinLimits("static", {
    body,
    urls: STATIC_SITEMAP_PAGES.length,
    lastModified: null,
    empty: false,
  });
}

/* -------------------------------------------------------------------------- */
/* Prompt 34 Part B: pre-warm + one-call health report                        */
/* -------------------------------------------------------------------------- */

import { loadSitemap, type SitemapServed } from "@/lib/sitemap-cache";

export type SitemapReport = {
  file: string;
  status: number;
  ms: number;
  bytes: number;
  urls: number;
};

/** Every file this site publishes, in index order. */
export async function sitemapFileList(db: SitemapDb | null = getSitemapDb()): Promise<string[]> {
  const [{ chunks: episodeChunks }, animeRows] = await Promise.all([
    episodeChunkCountStable(db),
    countRows(db, "anime").catch(() => 0),
  ]);
  const animeChunks = chunkCountFor(animeRows);
  return [
    "sitemap.xml",
    "static.xml",
    "new.xml",
    ...Array.from({ length: animeChunks }, (_, index) => `anime-${index + 1}.xml`),
    ...Array.from({ length: episodeChunks }, (_, index) => `episodes-${index + 1}.xml`),
  ];
}

async function buildOne(
  file: string,
  db: SitemapDb | null,
  fresh: boolean,
): Promise<{ served: SitemapServed | null; isIndex: boolean }> {
  if (file === "sitemap.xml") {
    return { served: await loadSitemap("sitemap:index", () => buildSitemapIndexPayload(db), { fresh }), isIndex: true };
  }
  if (file === "static.xml") {
    return { served: await loadSitemap("sitemap:static", async () => buildStaticSitemapPayload(), { fresh }), isIndex: false };
  }
  if (file === "new.xml") {
    return { served: await loadSitemap("sitemap:new", () => buildRecentSitemapPayload(db), { fresh }), isIndex: false };
  }
  const parsed = parseSitemapFileName(file);
  if (!parsed) return { served: null, isIndex: false };
  return {
    served: await loadSitemap(`sitemap:${parsed.kind}:${parsed.page}`, () => buildChunkSitemap(parsed, db), { fresh }),
    isIndex: false,
  };
}

/**
 * Builds the index and every child through the same cached path the crawler
 * hits, and reports what happened to each one. Used by the refresh cron to
 * pre-warm (so the next crawler gets a warm file) and by the sitemap-check
 * health route.
 */
export async function buildSitemapReport(
  db: SitemapDb | null = getSitemapDb(),
  options: { fresh?: boolean; budgetMs?: number; files?: string[] } = {},
): Promise<SitemapReport[]> {
  const fresh = options.fresh ?? true;
  const files = options.files ?? (await sitemapFileList(db));
  const started = Date.now();
  const budget = options.budgetMs ?? 100000;
  const report: SitemapReport[] = [];

  for (const file of files) {
    if (Date.now() - started > budget) break;
    const at = Date.now();
    try {
      const { served, isIndex } = await buildOne(file, db, fresh);
      if (!served) {
        report.push({ file, status: 404, ms: Date.now() - at, bytes: 0, urls: 0 });
        continue;
      }
      report.push({
        file,
        // An empty index is a real (bad) state, not a missing file.
        status: served.payload.empty && !isIndex ? 404 : 200,
        ms: Date.now() - at,
        bytes: Buffer.byteLength(served.payload.body, "utf8"),
        urls: served.payload.urls,
      });
    } catch (error) {
      report.push({ file, status: 503, ms: Date.now() - at, bytes: 0, urls: 0 });
      console.error(
        `[sitemap] report item failed file=${file} elapsed_ms=${Date.now() - at} error=${
          formatError(error)
        }`,
      );
    }
  }

  return report;
}
