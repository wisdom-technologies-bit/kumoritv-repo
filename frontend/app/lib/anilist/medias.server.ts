'use server';

import { unstable_cache } from 'next/cache';
import { AniListNotFoundError, AniListRateLimitedError, anilistFetch } from './client';
import { requestAiringSchedule, requestMediaById, requestMedias, requestMediasByDateRelease, requestMediasByTrendingSort, requestPremieringSoon } from './queries';
import { prepareAiringSchedule } from '@/app/lib/schedule/format';
import type { PremieringFetch, ScheduleFetch, ScheduleItem } from '@/app/lib/schedule/types';
import type { MediaDataFullInfo } from '@/app/ts/interfaces/anilistMediaData';
import { parseGenreParam } from '@/app/lib/search/genres';
import { displayTitle } from '@/app/lib/titles';
import { adultQueryVariables, filterMediasWithAdultContent, readShowAdultContent } from './adult-content';

const season = () => ['WINTER', 'SPRING', 'SUMMER', 'FALL'][Math.floor((new Date().getMonth() + 1) / 3) % 4] || 'WINTER';
const timestamp = (daysAgo: number, firstHour: boolean) => {
  const date = new Date();
  date.setUTCHours(firstHour ? 0 : 23, firstHour ? 1 : 59, firstHour ? 0 : 59, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return Math.floor(date.getTime() / 1000);
};

function withoutAdult<T>(items: T[], showAdultContent: boolean) {
  return filterMediasWithAdultContent(items, showAdultContent);
}

/** An explicit argument (from the API) wins; otherwise the server decides. */
async function shouldShowAdultContent(explicit?: boolean) {
  if (typeof explicit === 'boolean') return explicit;
  return readShowAdultContent();
}

function cached<T>(name: string, variables: Record<string, unknown>, ttl: number, load: () => Promise<T>) {
  return unstable_cache(load, [`anilist:${name}`, ...Object.entries(variables).sort().map(([key, value]) => `${key}:${String(value)}`)], { tags: ['anilist'], revalidate: ttl })();
}

export type MediaOptions = {
  type?: string; format?: string; sort?: string; showAdultContent?: boolean; status?: string;
  page?: number; perPage?: number; accessToken?: string; season?: string; seasonYear?: number;
  releasedOnLastXDays?: number; showOnlyReleasesOnThisDate?: boolean;
};

export async function getNewReleases(options: MediaOptions = {}): Promise<any[]> {
  const { type = 'ANIME', format = 'TV', sort = 'POPULARITY_DESC', status, page = 1, perPage = 20 } = options;
  const showAdultContent = await shouldShowAdultContent(options.showAdultContent);
  const variables = { type, format, sort: options.releasedOnLastXDays ? 'TIME_DESC' : sort, perPage, page, status, season: status ? undefined : season(), seasonYear: new Date().getFullYear(), ...adultQueryVariables(showAdultContent) };
  try {
    const data = await cached('new-releases', variables, options.releasedOnLastXDays ? 900 : 3600, () => anilistFetch<{ Page?: { media?: unknown[] } }>(requestMedias(), variables));
    return withoutAdult((data.Page?.media || []) as { isAdult?: boolean }[], showAdultContent);
  } catch { return []; }
}

export async function getReleasingThisWeek(options: MediaOptions = {}) {
  return getNewReleases({ ...options, format: 'TV', sort: 'TRENDING_DESC', perPage: 10, season: season(), seasonYear: new Date().getFullYear() });
}

export async function getReleasingByDaysRange(options: MediaOptions & { days?: number; pageNumber?: number } = {}): Promise<any[]> {
  const { type = 'ANIME', days = 0, pageNumber = 1, perPage = 5, showOnlyReleasesOnThisDate } = options;
  const showAdultContent = await shouldShowAdultContent(options.showAdultContent);
  const variables = { type, page: pageNumber, perPage, sort: 'TIME_DESC', airingAt_greater: timestamp(days, true), airingAt_lesser: timestamp(showOnlyReleasesOnThisDate ? days : 0, false) };
  try {
    const data = await cached('releasing-by-days', variables, 900, () => anilistFetch<{ Page?: { airingSchedules?: unknown[] } }>(requestMediasByDateRelease(), variables));
    // airingSchedules cannot take `isAdult`, so filter the nested media here.
    const results = (data.Page?.airingSchedules || []) as Array<{ media: { isAdult?: boolean } }>;
    return withoutAdult(results, showAdultContent);
  } catch { return []; }
}

export async function getTrendingMedia(options: { sort?: string; showAdultContent?: boolean; accessToken?: string; page?: number; perPage?: number } = {}): Promise<any[]> {
  const { sort = 'TRENDING_DESC', page = 1, perPage = 20 } = options;
  const showAdultContent = await shouldShowAdultContent(options.showAdultContent);
  const variables = { sort, page, perPage };
  try {
    const data = await cached('trending', variables, 3600, () => anilistFetch<{ Page?: { mediaTrends?: unknown[] } }>(requestMediasByTrendingSort(), variables));
    const results = (data.Page?.mediaTrends || []) as Array<{ media: { isAdult?: boolean } }>;
    return withoutAdult(results, showAdultContent);
  } catch { return []; }
}

export async function getMediaInfo({ id }: { id: number; accessToken?: string }) {
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    return await unstable_cache(
      () => anilistFetch<{ Media?: MediaDataFullInfo | null }>(requestMediaById(), { id }).then((data) => data.Media || null),
      ['anilist', 'media', String(id)],
      { tags: ['anilist'], revalidate: 10800 },
    )();
  } catch { return null; }
}

/**
 * The same lookup as getMediaInfo, but it TELLS the caller why it failed.
 *
 * getMediaInfo returns null for "rate limited", "not found" and "AniList is down"
 * alike, which made importAnime report "AniList metadata unavailable" for a plain
 * 429. The import pipeline needs the difference: a rate limit must be rescheduled
 * without burning the row's attempts, a missing media is terminal.
 *
 * Deliberately not wrapped in unstable_cache: caching a rate-limited answer for
 * three hours would keep the import queue stuck.
 */
export type MediaInfoResult =
  | { status: 'ok'; media: MediaDataFullInfo }
  | { status: 'not_found' }
  | { status: 'rate_limited'; retryAfterMs: number; message: string }
  | { status: 'unavailable'; message: string };

export async function getMediaInfoResult({ id }: { id: number }): Promise<MediaInfoResult> {
  if (!Number.isInteger(id) || id <= 0) return { status: 'not_found' };

  try {
    const data = await anilistFetch<{ Media?: MediaDataFullInfo | null }>(requestMediaById(), { id });
    const media = data.Media ?? null;

    return media ? { status: 'ok', media } : { status: 'not_found' };
  } catch (error) {
    if (error instanceof AniListRateLimitedError) {
      return { status: 'rate_limited', retryAfterMs: error.retryAfterMs, message: error.message };
    }

    if (error instanceof AniListNotFoundError) return { status: 'not_found' };

    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'AniList request failed',
    };
  }
}

export async function searchMedias({ query, page = 1, perPage = 15, showAdultContent: explicit }: { query: string; showAdultContent?: boolean; page?: number; perPage?: number }) {
  const search = query.trim();
  if (search.length < 2) return [];
  const showAdultContent = await shouldShowAdultContent(explicit);
  const variables = { search, page, perPage, sort: 'TRENDING_DESC', type: 'ANIME', ...adultQueryVariables(showAdultContent) };
  try {
    const data = await cached('search', variables, 600, () => anilistFetch<{ Page?: { media?: unknown[] } }>(requestMedias('$search: String', ', search: $search'), variables));
    return withoutAdult((data.Page?.media || []) as { isAdult?: boolean }[], showAdultContent);
  } catch { return []; }
}

// Catalog `?type=` values -> the AniList type/format pair they mean. Manga-like
// values are MANGA entries; anime-like values keep their own format. No value means
// no format filter at all (never a forced 'TV').
const CATALOG_TYPE_ANIME: Record<string, string> = { tv: 'TV', movie: 'MOVIE', special: 'SPECIAL', ova: 'OVA', ona: 'ONA', music: 'MUSIC', tv_short: 'TV_SHORT' };
const CATALOG_TYPE_MANGA: Record<string, string> = { manga: 'MANGA', novel: 'NOVEL', one_shot: 'ONE_SHOT' };

// Sorts linked from the header/footer/sidebar -> AniList sorts.
const CATALOG_SORTS: Record<string, string> = {
  trending_desc: 'TRENDING_DESC',
  releases_desc: 'START_DATE_DESC',
  releases_asc: 'START_DATE',
  score_desc: 'SCORE_DESC',
  title_asc: 'TITLE_ENGLISH',
  title_desc: 'TITLE_ENGLISH_DESC',
};

const CATALOG_STATUS: Record<string, string> = { finished: 'FINISHED', ongoing: 'RELEASING', upcoming: 'NOT_YET_RELEASED', unknown: 'HIATUS' };

export async function searchCatalog(options: { type?: string; title?: string; genre?: string | string[]; year?: number; status?: string; page?: string; sort?: string; season?: string; showAdultContent?: boolean } = {}) {
  const showAdultContent = await shouldShowAdultContent(options.showAdultContent);
  const page = Math.min(8, Math.max(1, Number(options.page) || 1));
  const { genres, tags } = parseGenreParam(options.genre);
  const catalogType = options.type ? String(options.type).toLowerCase() : '';
  const isManga = catalogType in CATALOG_TYPE_MANGA;
  const variables = {
    search: options.title?.trim() || undefined,
    seasonYear: options.year,
    // A season only exists for anime, so mangas ignore it.
    season: isManga ? undefined : options.season?.toUpperCase(),
    format: isManga ? CATALOG_TYPE_MANGA[catalogType] : CATALOG_TYPE_ANIME[catalogType],
    status: CATALOG_STATUS[options.status || ''],
    genre_in: genres.length ? genres : undefined,
    tag_in: tags.length ? tags : undefined,
    sort: CATALOG_SORTS[options.sort || ''] || 'START_DATE_DESC',
    type: isManga ? 'MANGA' : 'ANIME',
    perPage: 12,
    ...adultQueryVariables(showAdultContent),
  };
  try {
    const pages = await Promise.all(Array.from({ length: page }, (_, index) => cached('catalog', { ...variables, page: index + 1 }, 600, () => anilistFetch<{ Page?: { media?: any[]; pageInfo?: { total?: number } } }>(requestMedias('$search: String, $genre_in: [String], $tag_in: [String]', ', search: $search, genre_in: $genre_in, tag_in: $tag_in'), { ...variables, page: index + 1 }))));
    const media = withoutAdult(pages.flatMap((result) => result.Page?.media || []) as { isAdult?: boolean }[], showAdultContent) as any[];
    return { results: media.map((item) => ({ ...item, title: displayTitle(item.title), picture: item.coverImage?.large || '', thumbnail: item.coverImage?.large || '', coverImage: item.coverImage, tags: item.genres || [], animeSeason: { season: item.season, year: item.seasonYear }, anilistId: String(item.id), id: String(item.id) })), allResultsLength: pages[0]?.Page?.pageInfo?.total || 0 };
  } catch (error) {
    console.error('[searchCatalog] AniList request failed', error instanceof Error ? error.message : String(error));
    return { results: [], allResultsLength: 0 };
  }
}

export async function getMediaForThisFormat(options: MediaOptions & { pageNumber?: number } = {}) {
  const { type = 'ANIME', status, sort = 'TRENDING_DESC', pageNumber = 1, perPage = 20 } = options;
  // The 'TV' default only makes sense for anime: MANGA + TV matches nothing, which is
  // why the manga rows on the homepage came back empty. Mangas get no default format.
  const format = options.format ?? (type === 'ANIME' ? 'TV' : undefined);
  const showAdultContent = await shouldShowAdultContent(options.showAdultContent);
  const variables = { type, format, status, sort, page: pageNumber, perPage, season: options.season, seasonYear: options.seasonYear, ...adultQueryVariables(showAdultContent) };
  try {
    const data = await cached('media-for-format', variables, 3600, () => anilistFetch<{ Page?: { media?: unknown[] } }>(requestMedias(), variables));
    return withoutAdult((data.Page?.media || []) as { isAdult?: boolean }[], showAdultContent);
  } catch { return []; }
}

/* ---------------------------------------------------------------------------
   Prompt 33 Part B - the release schedule feed.

   A single week window is fetched in one go (paged, because AniList caps a page
   at 50 rows), then cached for five minutes under the `schedule` tag. The client
   never talks to AniList: it receives these rows and does the time-zone work.
   --------------------------------------------------------------------------- */

/** AniList's hard page cap is 50; eight pages is a very busy week. */
const SCHEDULE_PER_PAGE = 50;
const SCHEDULE_MAX_PAGES = 8;
/** Total budget for one window, including the pauses between pages. */
const SCHEDULE_BUDGET_MS = 20_000;
const SCHEDULE_PAGE_PAUSE_MS = 120;
/** A week plus its margins. Anything wider is a bug, not a request. */
const SCHEDULE_MAX_SPAN_SECONDS = 21 * 86_400;

type AiringPage = {
  Page?: {
    pageInfo?: { hasNextPage?: boolean };
    airingSchedules?: Array<{
      id: number;
      airingAt: number;
      episode: number;
      media?: ScheduleItem['media'] | null;
    }>;
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The last good answer per window: what a failed refresh falls back to. */
const lastGoodSchedule = new Map<string, { items: ScheduleItem[]; pages: number; fetchedAt: number }>();

async function normaliseScheduleWindow(from: number, to: number): { from: number; to: number } {
  const start = Math.floor(Number(from));
  const end = Math.floor(Number(to));
  const safeStart = Number.isFinite(start) ? start : Math.floor(Date.now() / 1000);
  const safeEnd = Number.isFinite(end) ? end : safeStart + 9 * 86_400;
  const [lo, hi] = safeStart <= safeEnd ? [safeStart, safeEnd] : [safeEnd, safeStart];
  return { from: lo, to: Math.min(hi, lo + SCHEDULE_MAX_SPAN_SECONDS) };
}

async function loadScheduleWindow(from: number, to: number, showAdultContent: boolean) {
  const startedAt = Date.now();
  const rows: ScheduleItem[] = [];

  for (let page = 1; page <= SCHEDULE_MAX_PAGES; page += 1) {
    if (Date.now() - startedAt > SCHEDULE_BUDGET_MS) break;

    let data: AiringPage;
    try {
      data = await anilistFetch<AiringPage>(requestAiringSchedule(), {
        page,
        perPage: SCHEDULE_PER_PAGE,
        airingAt_greater: from,
        airingAt_lesser: to,
      });
    } catch (error) {
      // A rate limit is not a reason to serve half a page: reuse the last good
      // window when we have one, otherwise say AniList is unavailable.
      if (error instanceof AniListRateLimitedError) throw error;
      if (page > 1) break;
      throw error;
    }

    for (const item of data.Page?.airingSchedules ?? []) {
      if (!item || !item.media) continue;
      rows.push({ id: item.id, airingAt: item.airingAt, episode: item.episode, media: item.media });
    }

    if (!data.Page?.pageInfo?.hasNextPage) break;
    await sleep(SCHEDULE_PAGE_PAUSE_MS);
  }

  // `airingSchedules` has no isAdult argument, so the nested media is filtered.
  const items = prepareAiringSchedule(rows, { showAdultContent });
  return { items, pages: Math.min(SCHEDULE_MAX_PAGES, Math.max(1, Math.ceil(items.length / SCHEDULE_PER_PAGE))) };
}

export async function getAiringSchedule({ from, to, showAdultContent: explicit }: { from: number; to: number; showAdultContent?: boolean }): Promise<ScheduleFetch> {
  const window = await normaliseScheduleWindow(from, to);
  const key = `${window.from}:${window.to}`;
  const showAdultContent = await shouldShowAdultContent(explicit);

  try {
    const result = await unstable_cache(
      async () => loadScheduleWindow(window.from, window.to, showAdultContent),
      ['anilist', 'schedule', key, showAdultContent ? 'adult' : 'clean'],
      { tags: ['anilist', 'schedule'], revalidate: 300 },
    )();

    lastGoodSchedule.set(key, { ...result, fetchedAt: Math.floor(Date.now() / 1000) });
    return { items: result.items, ok: true, pages: result.pages, fetchedAt: Math.floor(Date.now() / 1000) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AniList request failed';
    const fallback = lastGoodSchedule.get(key);
    if (fallback) {
      return { items: fallback.items, ok: true, stale: true, pages: fallback.pages, fetchedAt: fallback.fetchedAt, error: message };
    }
    return { items: [], ok: false, pages: 0, fetchedAt: Math.floor(Date.now() / 1000), error: message };
  }
}

/** The "Premiering soon" row: NOT_YET_RELEASED titles starting in 30 days. */
export async function getPremieringSoon({ limit = 8, showAdultContent: explicit }: { limit?: number; showAdultContent?: boolean } = {}): Promise<PremieringFetch> {
  const showAdultContent = await shouldShowAdultContent(explicit);
  const now = new Date();
  const fuzzy = (date: Date) => Number(date.toISOString().slice(0, 10).replace(/-/g, ''));
  const from = fuzzy(now);
  const to = fuzzy(new Date(now.getTime() + 30 * 86_400_000));

  try {
    const data = await unstable_cache(
      async () =>
        anilistFetch<{ Page?: { media?: unknown[] } }>(requestPremieringSoon(), { page: 1, perPage: limit, from, to, ...adultQueryVariables(showAdultContent) }),
      ['anilist', 'premiering-soon', `${from}:${to}:${limit}:${showAdultContent ? 'adult' : 'clean'}`],
      { tags: ['anilist', 'schedule'], revalidate: 1800 },
    )();
    const items = withoutAdult((data.Page?.media ?? []) as { isAdult?: boolean }[], showAdultContent).slice(0, limit);
    return { items: items as PremieringFetch['items'], ok: true, fetchedAt: Math.floor(Date.now() / 1000) };
  } catch {
    return { items: [], ok: false, fetchedAt: Math.floor(Date.now() / 1000) };
  }
}
