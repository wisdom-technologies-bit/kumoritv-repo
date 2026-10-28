import "server-only";
// MangaDex, straight from the browser-less server: no Express backend, no keys.
// Docs: https://api.mangadex.org/docs (search, feed and At-Home endpoints).

import { createAdminClient } from "@/app/lib/supabase/admin";
import { getMediaInfo } from "@/app/lib/anilist/medias.server";
import type { MangadexMangaChapters, MangadexMangaPages } from "@/app/ts/interfaces/mangadex";

const API_BASE = "https://api.mangadex.org";
const USER_AGENT = "KumoriTV/1.0";
const TIMEOUT_MS = 8_000;
const MAX_RETRY_DELAY_MS = 2_000;
const RETRY_FALLBACK_DELAY_MS = 1_000;
export const FEED_PAGE_SIZE = 500;
export const MAX_FEED_PAGES = 10;
export const NOT_FOUND_RECHECK_MS = 24 * 60 * 60 * 1000;
// Adult titles are allowed everywhere on this site and never filtered or isolated.
const CONTENT_RATINGS = ["safe", "suggestive", "erotica", "pornographic"];

export type MangaSourceRow = {
  anilist_id: number;
  mangadex_id: string | null;
  title: string | null;
  not_found: boolean;
  checked_at: string;
};

type AdminLike = {
  from(table: string): any;
};

let adminOverride: AdminLike | null | undefined;

/** Test seam: swaps the Supabase admin client used for the manga_sources cache. */
export function __setAdminClientForTests(client: AdminLike | null | undefined): void {
  adminOverride = client;
}

function adminClient(): AdminLike | null {
  if (adminOverride !== undefined) return adminOverride;
  try {
    return createAdminClient() as unknown as AdminLike | null;
  } catch {
    return null;
  }
}

export class MangadexRequestError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "MangadexRequestError";
    this.status = status;
  }
}

type FetchOptions = { revalidate?: number; timeoutMs?: number };

function buildUrl(path: string, params?: Record<string, string | number | boolean | string[] | undefined>) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
    else url.searchParams.append(key, String(value));
  }
  return url.toString();
}

function retryDelayMs(response: Response): number {
  const header = response.headers.get("Retry-After") ?? response.headers.get("X-RateLimit-Retry-After");
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return RETRY_FALLBACK_DELAY_MS;
  // The header can be a delay in seconds or a UNIX timestamp; treat big numbers as timestamps.
  const asDelay = seconds > 10_000 ? Math.max(0, seconds * 1000 - Date.now()) : seconds * 1000;
  return Math.min(MAX_RETRY_DELAY_MS, asDelay);
}

/** GET a MangaDex endpoint. One retry on 429/5xx (honouring Retry-After, capped at 2s). */
export async function mangadexGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | string[] | undefined>,
  options: FetchOptions = {},
): Promise<T> {
  const url = buildUrl(path, params);
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    // `cache` and `next.revalidate` fight each other: pass only one. A caller that
    // wants a cache window gets `revalidate`, everyone else gets `no-store`.
    const init: RequestInit & { next?: { revalidate: number } } = {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (options.revalidate !== undefined) init.next = { revalidate: options.revalidate };
    else init.cache = "no-store";

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new MangadexRequestError(
        error instanceof Error ? error.message : "MangaDex request failed",
      );
    }

    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response)));
      continue;
    }

    if (!response.ok) {
      throw new MangadexRequestError(`MangaDex HTTP ${response.status}`, response.status);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new MangadexRequestError("MangaDex returned invalid JSON", response.status);
    }
  }

  throw new MangadexRequestError("MangaDex request failed");
}

// ------------------------------------------------------------------ matching

export function normaliseTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type MangaCandidate = {
  id: string;
  attributes?: {
    title?: Record<string, string>;
    altTitles?: Record<string, string>[];
    links?: Record<string, string>;
    year?: number | null;
  };
};

function candidateTitles(candidate: MangaCandidate): string[] {
  const attributes = candidate.attributes ?? {};
  return [
    ...Object.values(attributes.title ?? {}),
    ...(attributes.altTitles ?? []).flatMap((entry) => Object.values(entry ?? {})),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function matchesTarget(candidate: MangaCandidate, targetTitles: Set<string>, year?: number): boolean {
  const hasTitleMatch = candidateTitles(candidate).some((title) => targetTitles.has(normaliseTitle(title)));
  if (!hasTitleMatch) return false;
  if (!year) return true;
  const candidateYear = candidate.attributes?.year;
  if (!candidateYear) return false;
  return Number(candidateYear) === Number(year);
}

// ------------------------------------------------------------- source caching

async function readSource(anilistId: number): Promise<MangaSourceRow | null> {
  const client = adminClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from("manga_sources")
      .select("anilist_id, mangadex_id, title, not_found, checked_at")
      .eq("anilist_id", anilistId)
      .maybeSingle();
    if (error || !data) return null;
    return data as MangaSourceRow;
  } catch {
    return null;
  }
}

async function writeSource(row: MangaSourceRow): Promise<void> {
  const client = adminClient();
  if (!client) return;
  try {
    const { error } = await client
      .from("manga_sources")
      .upsert(row, { onConflict: "anilist_id" });
    if (error) return;
  } catch {
    /* the cache is best effort: a missing table must never break reading */
  }
}

// ------------------------------------------------------------------ resolving

/**
 * Finds the MangaDex entry for an AniList manga. Trusts `attributes.links.al`
 * first; without it, only an exact normalised title/altTitle match (plus the same
 * year, when both are known) is accepted.
 */
export async function resolveMangaDexId(
  anilistId: number,
  titles: string[],
  options: { year?: number } = {},
): Promise<string | null> {
  const cached = await readSource(anilistId);
  if (cached) {
    const checkedAt = Date.parse(cached.checked_at) || 0;
    const isFresh = Date.now() - checkedAt < NOT_FOUND_RECHECK_MS;
    if (cached.not_found) {
      if (isFresh) return null;
    } else if (cached.mangadex_id) {
      return cached.mangadex_id;
    }
  }

  const queries = [...new Set(titles.map((title) => (title ?? "").trim()).filter(Boolean))].slice(0, 4);
  const targetTitles = new Set(queries.map(normaliseTitle).filter(Boolean));
  const seen = new Map<string, MangaCandidate>();
  // A failed search proves nothing about the manga existing: only a search that
  // actually answered is allowed to record a not-found row (and its 24h block).
  let searchSucceeded = false;

  for (const query of queries) {
    try {
      const payload = await mangadexGet<{ data?: MangaCandidate[] }>("/manga", {
        title: query,
        limit: 10,
        "order[relevance]": "desc",
        "includes[]": ["cover_art"],
        "contentRating[]": CONTENT_RATINGS,
      }, { revalidate: 3600 });
      searchSucceeded = true;
      for (const candidate of payload.data ?? []) {
        if (candidate?.id && !seen.has(candidate.id)) seen.set(candidate.id, candidate);
      }
    } catch {
      continue;
    }
  }

  const candidates = [...seen.values()];

  const byAniListLink = candidates.find((candidate) => String(candidate.attributes?.links?.al ?? "") === String(anilistId));
  const byTitle = candidates.find(
    (candidate) => !candidate.attributes?.links?.al && matchesTarget(candidate, targetTitles, options.year),
  );
  const match = byAniListLink ?? byTitle ?? null;

  if (match) {
    await writeSource({
      anilist_id: anilistId,
      mangadex_id: match.id,
      title: Object.values(match.attributes?.title ?? {})[0] ?? queries[0] ?? null,
      not_found: false,
      checked_at: new Date().toISOString(),
    });

    return match.id;
  }

  // Every request failed (network, timeout, 429/5xx after the retry): leave the
  // cache untouched so the next visit tries again instead of serving a 24h block.
  if (!searchSucceeded) return null;

  await writeSource({
    anilist_id: anilistId,
    mangadex_id: null,
    title: queries[0] ?? null,
    not_found: true,
    checked_at: new Date().toISOString(),
  });

  return null;
}

// ------------------------------------------------------------------- chapters

type FeedChapter = {
  id: string;
  attributes?: {
    chapter?: string | null;
    volume?: string | null;
    title?: string | null;
    pages?: number;
    externalUrl?: string | null;
    publishAt?: string;
  };
};

function chapterNumberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function mapChapter(chapter: FeedChapter): MangadexMangaChapters {
  const attributes = chapter.attributes ?? {};
  // The old backend used "0" for one-shots, which have no chapter number.
  const chapterNumber = attributes.chapter ? String(attributes.chapter) : "0";
  return {
    id: chapter.id,
    chapterNumber,
    volumeNumber: attributes.volume ? String(attributes.volume) : "",
    title: attributes.title && attributes.title.length > 0 ? attributes.title : chapterNumber,
    pages: Number(attributes.pages ?? 0),
  };
}

/** English chapters with readable pages, one per chapter number, oldest first. */
export async function listChapters(mangadexId: string): Promise<MangadexMangaChapters[]> {
  const collected: FeedChapter[] = [];

  for (let page = 0; page < MAX_FEED_PAGES; page += 1) {
    const payload = await mangadexGet<{ data?: FeedChapter[]; total?: number }>(
      `/manga/${encodeURIComponent(mangadexId)}/feed`,
      {
        "translatedLanguage[]": ["en"],
        "order[chapter]": "asc",
        limit: FEED_PAGE_SIZE,
        offset: page * FEED_PAGE_SIZE,
        includeExternalUrl: 0,
        "contentRating[]": CONTENT_RATINGS,
      },
      { revalidate: 3600 },
    );

    const batch = payload.data ?? [];
    collected.push(...batch);

    const total = Number(payload.total ?? 0);
    if (batch.length < FEED_PAGE_SIZE) break;
    if (total && (page + 1) * FEED_PAGE_SIZE >= total) break;
  }

  // Licensed/external and page-less chapters are not readable here.
  const readable = collected.filter((chapter) => {
    const attributes = chapter.attributes ?? {};
    return !attributes.externalUrl && Number(attributes.pages ?? 0) > 0;
  });

  // One entry per chapter number: the one with the most pages, then the newest.
  const byNumber = new Map<string, FeedChapter>();
  for (const chapter of readable) {
    const mapped = mapChapter(chapter);
    const current = byNumber.get(mapped.chapterNumber);
    if (!current) {
      byNumber.set(mapped.chapterNumber, chapter);
      continue;
    }
    const currentMapped = mapChapter(current);
    const newerOnTie = (chapter.attributes?.publishAt ?? "") > (current.attributes?.publishAt ?? "");
    if (mapped.pages > currentMapped.pages || (mapped.pages === currentMapped.pages && newerOnTie)) {
      byNumber.set(mapped.chapterNumber, chapter);
    }
  }

  return [...byNumber.values()]
    .map(mapChapter)
    .sort((a, b) => chapterNumberValue(a.chapterNumber) - chapterNumberValue(b.chapterNumber));
}

// ---------------------------------------------------------------------- pages

export function buildPageUrls(
  baseUrl: string,
  hash: string,
  files: string[],
  quality: "data" | "data-saver" = "data",
): MangadexMangaPages[] {
  return files.map((file, index) => ({
    page: index + 1,
    img: `${baseUrl}/${quality}/${hash}/${file}`,
  }));
}

/** Fresh node URLs for a chapter: they expire, so they are never cached for long. */
export async function getChapterPages(chapterId: string): Promise<MangadexMangaPages[]> {
  const payload = await mangadexGet<{
    baseUrl?: string;
    chapter?: { hash?: string; data?: string[]; dataSaver?: string[] };
  }>(`/at-home/server/${encodeURIComponent(chapterId)}`, undefined, { revalidate: 60 });

  const baseUrl = payload.baseUrl;
  const hash = payload.chapter?.hash;
  const files = payload.chapter?.data ?? [];
  if (!baseUrl || !hash || files.length === 0) {
    throw new MangadexRequestError("MangaDex returned no pages for this chapter");
  }

  return buildPageUrls(baseUrl, hash, files);
}

/** Chapter list for an AniList id, with the status the UI needs. */
export async function getChaptersForAniListMedia(
  anilistId: number,
  titles: string[],
  options: { year?: number } = {},
): Promise<{ status: "ready" | "unavailable" | "error"; chapters: MangadexMangaChapters[] }> {
  try {
    const mangadexId = await resolveMangaDexId(anilistId, titles, options);
    if (!mangadexId) return { status: "unavailable", chapters: [] };
    const chapters = await listChapters(mangadexId);
    if (chapters.length === 0) return { status: "unavailable", chapters: [] };
    return { status: "ready", chapters };
  } catch {
    return { status: "error", chapters: [] };
  }
}

export type ChaptersByAniListId = {
  status: "ready" | "unavailable" | "error";
  chapters: MangadexMangaChapters[];
  title?: string;
};

/** Titles and year come from AniList, the chapters from MangaDex. */
export async function getChaptersByAniListId(anilistId: number): Promise<ChaptersByAniListId> {
  if (!Number.isInteger(anilistId) || anilistId <= 0) return { status: "error", chapters: [] };

  let mediaInfo: Awaited<ReturnType<typeof getMediaInfo>> = null;
  try {
    mediaInfo = await getMediaInfo({ id: anilistId });
  } catch {
    mediaInfo = null;
  }

  if (!mediaInfo) return { status: "error", chapters: [] };

  const titles = [
    mediaInfo.title?.romaji,
    mediaInfo.title?.english,
    mediaInfo.title?.native,
    ...(mediaInfo.synonyms ?? []),
  ].filter((title): title is string => Boolean(title && title.trim()));

  const result = await getChaptersForAniListMedia(anilistId, titles, {
    year: mediaInfo.startDate?.year ?? undefined,
  });

  return { ...result, title: mediaInfo.title?.userPreferred || mediaInfo.title?.romaji };
}
