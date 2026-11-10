import { createAdminClient } from "@/app/lib/supabase/admin";
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

/** One chunk (CHUNK_SIZE rows) of playable episodes, ordered by id then episode. */
export async function fetchEpisodeSlice(db: SitemapDb | null, page: number, size = CHUNK_SIZE): Promise<SitemapEpisode[]> {
  const from = (Math.max(1, page) - 1) * size;
  const rows = await readRowsPaged<any>(db, {
    table: SITEMAP_EPISODES_VIEW,
    columns: "anilist_id,episode_number,updated_at,air_date",
    order: ["anilist_id", "episode_number"],
    chunkStart: from,
    chunkEnd: from + size - 1,
  });
  return rows.map(parseSitemapEpisode).filter((row): row is SitemapEpisode => row !== null);
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
export function sitemapIndexFiles(animeCount: number, episodeCount: number): Array<{ loc: string }> {
  const chunksFor = (count: number) => Math.max(0, Math.ceil((Number(count) || 0) / CHUNK_SIZE));
  return [
    { loc: `${SITE_URL}/sitemaps/static.xml` },
    { loc: `${SITE_URL}/sitemaps/new.xml` },
    ...Array.from({ length: chunksFor(animeCount) }, (_, index) => ({ loc: `${SITE_URL}/sitemaps/anime-${index + 1}.xml` })),
    ...Array.from({ length: chunksFor(episodeCount) }, (_, index) => ({ loc: `${SITE_URL}/sitemaps/episodes-${index + 1}.xml` })),
  ];
}

export async function recentAiringTopUp() {
  try { const page = await fetchAiringWindow(Math.floor(Date.now() / 1000) - 21600, Math.floor(Date.now() / 1000), 1); return (page.airingSchedules || []).filter((item: any) => item.airingAt <= Date.now() / 1000); } catch { return []; }
}
export const chunks = <T,>(items: T[], size = CHUNK_SIZE) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
