import { createAdminClient } from "@/app/lib/supabase/admin";
import { fetchAiringWindow } from "@/app/lib/discovery/anilist";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://kumoritv.top").replace(/\/$/, "");
export const CHUNK_SIZE = 40000;
/** Hard cap on the AniList top-up rows a single new.xml request will consider. */
export const RECENT_TOPUP_LIMIT = 2000;
/** Hard cap on view rows read for new.xml (48h window). */
export const RECENT_EPISODE_LIMIT = 4000;

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
export function sitemapDoc(urls: string[]) { return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`; }
export function indexDoc(files: Array<{ loc: string; lastmod?: string }>) { return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map((file) => `<sitemap><loc>${xmlEscape(file.loc)}</loc>${file.lastmod ? `<lastmod>${xmlEscape(file.lastmod)}</lastmod>` : ""}</sitemap>`).join("")}</sitemapindex>`; }

/** Supabase-shaped client. The view is not in the generated types, so it is `any`. */
export type SitemapDb = { from: (table: string) => any };

export function getSitemapDb(): SitemapDb | null {
  return createAdminClient() as unknown as SitemapDb | null;
}

async function range<T>(
  db: SitemapDb | null,
  table: string,
  columns: string,
  order: string[],
  from: number,
  to: number,
): Promise<T[]> {
  if (!db) return [] as T[];
  let query: any = db.from(table).select(columns);
  for (const column of order) query = query.order(column, { ascending: true });
  const { data, error } = await query.range(from, to);
  if (error) throw error;
  return (data || []) as T[];
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

/** One page of playable episodes, ordered by (anilist_id, episode_number). */
export async function fetchEpisodeSlice(db: SitemapDb | null, page: number, size = CHUNK_SIZE): Promise<SitemapEpisode[]> {
  const from = (Math.max(1, page) - 1) * size;
  const rows = await range<any>(db, SITEMAP_EPISODES_VIEW, "anilist_id,episode_number,updated_at", ["anilist_id", "episode_number"], from, from + size - 1);
  return rows.map(parseSitemapEpisode).filter((row): row is SitemapEpisode => row !== null);
}

/** One page of imported anime (media pages). */
export async function fetchMediaSlice(db: SitemapDb | null, page: number, size = CHUNK_SIZE): Promise<SitemapMedia[]> {
  const from = (Math.max(1, page) - 1) * size;
  const rows = await range<any>(db, "anime", "anilist_id,updated_at", ["anilist_id"], from, from + size - 1);
  return rows.map(parseSitemapMedia).filter((row): row is SitemapMedia => row !== null);
}

/** View rows touched in the last `hours` (new.xml). */
export async function fetchRecentEpisodes(db: SitemapDb | null, hours = 48): Promise<SitemapEpisode[]> {
  if (!db) return [] as SitemapEpisode[];
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const { data, error } = await db
    .from(SITEMAP_EPISODES_VIEW)
    .select("anilist_id,episode_number,updated_at")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(RECENT_EPISODE_LIMIT);
  if (error) throw error;
  return ((data || []) as any[]).map(parseSitemapEpisode).filter((row): row is SitemapEpisode => row !== null);
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
    urls.push(sitemapUrl(watchUrl(row.anilist_id, row.episode_number), row.updated_at, "always", "0.9"));
    if (!emittedMedia.has(row.anilist_id)) {
      emittedMedia.add(row.anilist_id);
      urls.push(sitemapUrl(mediaUrl(row.anilist_id), row.updated_at));
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

/** The index lists exactly as many chunks as the chunk routes can serve. */
export function sitemapIndexFiles(animeCount: number, episodeCount: number): Array<{ loc: string }> {
  const chunksFor = (count: number) => Math.max(0, Math.ceil((Number(count) || 0) / CHUNK_SIZE));
  return [
    { loc: `${SITE_URL}/sitemaps/new.xml` },
    ...Array.from({ length: chunksFor(animeCount) }, (_, index) => ({ loc: `${SITE_URL}/sitemaps/anime-${index + 1}.xml` })),
    ...Array.from({ length: chunksFor(episodeCount) }, (_, index) => ({ loc: `${SITE_URL}/sitemaps/episodes-${index + 1}.xml` })),
  ];
}

export async function recentAiringTopUp() {
  try { const page = await fetchAiringWindow(Math.floor(Date.now() / 1000) - 21600, Math.floor(Date.now() / 1000), 1); return (page.airingSchedules || []).filter((item: any) => item.airingAt <= Date.now() / 1000); } catch { return []; }
}
export const chunks = <T,>(items: T[], size = CHUNK_SIZE) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
