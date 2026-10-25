'use server';

import { unstable_cache } from 'next/cache';
import { anilistFetch } from './client';
import { requestMediaById, requestMedias, requestMediasByDateRelease, requestMediasByTrendingSort } from './queries';
import type { MediaDataFullInfo } from '@/app/ts/interfaces/anilistMediaData';

const season = () => ['WINTER', 'SPRING', 'SUMMER', 'FALL'][Math.floor((new Date().getMonth() + 1) / 3) % 4] || 'WINTER';
const timestamp = (daysAgo: number, firstHour: boolean) => {
  const date = new Date();
  date.setUTCHours(firstHour ? 0 : 23, firstHour ? 1 : 59, firstHour ? 0 : 59, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return Math.floor(date.getTime() / 1000);
};

function withoutAdult<T>(items: T[]) {
  return items;
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
  const { type = 'ANIME', format = 'TV', sort = 'POPULARITY_DESC', showAdultContent = undefined, status, page = 1, perPage = 20 } = options;
  const variables = { type, format, sort: options.releasedOnLastXDays ? 'TIME_DESC' : sort, perPage, page, status, season: status ? undefined : season(), seasonYear: new Date().getFullYear(), showAdultContent };
  try {
    const data = await cached('new-releases', variables, options.releasedOnLastXDays ? 900 : 3600, () => anilistFetch<{ Page?: { media?: unknown[] } }>(requestMedias(), variables));
    return withoutAdult((data.Page?.media || []) as { isAdult?: boolean }[]);
  } catch { return []; }
}

export async function getReleasingThisWeek(options: MediaOptions = {}) {
  return getNewReleases({ ...options, format: 'TV', sort: 'TRENDING_DESC', perPage: 10, season: season(), seasonYear: new Date().getFullYear() });
}

export async function getReleasingByDaysRange(options: MediaOptions & { days?: number; pageNumber?: number } = {}): Promise<any[]> {
  const { type = 'ANIME', days = 0, pageNumber = 1, perPage = 5, showAdultContent = undefined, showOnlyReleasesOnThisDate } = options;
  const variables = { type, page: pageNumber, perPage, sort: 'TIME_DESC', showAdultContent, airingAt_greater: timestamp(days, true), airingAt_lesser: timestamp(showOnlyReleasesOnThisDate ? days : 0, false) };
  try {
    const data = await cached('releasing-by-days', variables, 900, () => anilistFetch<{ Page?: { airingSchedules?: unknown[] } }>(requestMediasByDateRelease(), variables));
    const results = (data.Page?.airingSchedules || []) as Array<{ media: { isAdult?: boolean } }>;
    return results;
  } catch { return []; }
}

export async function getTrendingMedia(options: { sort?: string; showAdultContent?: boolean; accessToken?: string; page?: number; perPage?: number } = {}): Promise<any[]> {
  const { sort = 'TRENDING_DESC', showAdultContent = undefined, page = 1, perPage = 20 } = options;
  const variables = { sort, page, perPage };
  try {
    const data = await cached('trending', variables, 3600, () => anilistFetch<{ Page?: { mediaTrends?: unknown[] } }>(requestMediasByTrendingSort(), variables));
    const results = (data.Page?.mediaTrends || []) as Array<{ media: { isAdult?: boolean } }>;
    return results;
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

export async function searchMedias({ query, showAdultContent = undefined, page = 1, perPage = 15 }: { query: string; showAdultContent?: boolean; page?: number; perPage?: number }) {
  const search = query.trim();
  if (search.length < 2) return [];
  try {
    const data = await cached('search', { search, showAdultContent, page, perPage }, 600, () => anilistFetch<{ Page?: { media?: unknown[] } }>(requestMedias('$search: String', ', search: $search'), { search, showAdultContent, page, perPage, sort: 'TRENDING_DESC', type: 'ANIME' }));
    return withoutAdult((data.Page?.media || []) as { isAdult?: boolean }[]);
  } catch { return []; }
}

export async function searchCatalog(options: { type?: string; title?: string; genre?: string | string[]; year?: number; status?: string; page?: string; sort?: string; season?: string } = {}) {
  const page = Math.min(8, Math.max(1, Number(options.page) || 1));
  const genres = (Array.isArray(options.genre) ? options.genre : options.genre ? [options.genre] : []).filter(Boolean);
  const genreMap: Record<string, string> = { 'slice-of-life': 'Slice of Life', 'sci-fi': 'Sci-Fi', mahou: 'Mahou Shoujo' };
  const variables = { search: options.title?.trim() || undefined, seasonYear: options.year, season: options.season?.toUpperCase(), format: options.type ? ({ tv: 'TV', movie: 'MOVIE', special: 'SPECIAL', ova: 'OVA', ona: 'ONA', music: 'MUSIC', tv_short: 'TV_SHORT' } as Record<string, string>)[options.type] : undefined, status: options.status ? ({ finished: 'FINISHED', ongoing: 'RELEASING', upcoming: 'NOT_YET_RELEASED', unknown: 'HIATUS' } as Record<string, string>)[options.status] : undefined, genre_in: genres.filter((g) => g.toLowerCase() !== 'shoujo').map((g) => genreMap[g.toLowerCase()] || g), tag_in: genres.some((g) => g.toLowerCase() === 'shoujo') ? ['Shoujo'] : undefined, sort: ({ releases_asc: 'START_DATE', title_desc: 'TITLE_ENGLISH_DESC', title_asc: 'TITLE_ENGLISH' } as Record<string, string>)[options.sort || ''] || 'START_DATE_DESC', type: 'ANIME', perPage: 12, showAdultContent: undefined };
  try {
    const pages = await Promise.all(Array.from({ length: page }, (_, index) => cached('catalog', { ...variables, page: index + 1 }, 600, () => anilistFetch<{ Page?: { media?: any[]; pageInfo?: { total?: number } } }>(requestMedias('$search: String, $genre_in: [String], $tag_in: [String]', ', search: $search, genre_in: $genre_in, tag_in: $tag_in'), { ...variables, page: index + 1 }))));
    const media = pages.flatMap((result) => result.Page?.media || []);
    return { results: media.map((item) => ({ ...item, title: item.title?.userPreferred || item.title?.english || item.title?.romaji || item.title?.native || '', picture: item.coverImage?.large || '', thumbnail: item.coverImage?.large || '', coverImage: item.coverImage, tags: item.genres || [], animeSeason: { season: item.season, year: item.seasonYear }, anilistId: String(item.id), id: String(item.id) })), allResultsLength: pages[0]?.Page?.pageInfo?.total || 0 };
  } catch { return { results: [], allResultsLength: 0 }; }
}

export async function getMediaForThisFormat(options: MediaOptions & { pageNumber?: number } = {}) {
  const { type = 'ANIME', status, sort = 'TRENDING_DESC', pageNumber = 1, perPage = 20, showAdultContent = undefined, format = 'TV' } = options;
  const variables = { type, format, status, sort, page: pageNumber, perPage, showAdultContent, season: options.season, seasonYear: options.seasonYear };
  try {
    const data = await cached('media-for-format', variables, 3600, () => anilistFetch<{ Page?: { media?: unknown[] } }>(requestMedias(), variables));
    return withoutAdult((data.Page?.media || []) as { isAdult?: boolean }[]);
  } catch { return []; }
}
