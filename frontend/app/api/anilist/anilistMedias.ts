import { AiringMediaResult, MediaData, TrendingMediaResult } from '@/app/ts/interfaces/anilistMediaData';

async function homeRequest(fn: string, options: Record<string, unknown>): Promise<any[]> {
  const params = new URLSearchParams({ fn });
  Object.entries(options).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
  try {
    const response = await fetch(`/api/anilist/medias?${params}`, { cache: 'no-store' });
    if (!response.ok) return [];
    return ((await response.json()) as { results?: unknown[] }).results || [];
  } catch { return []; }
}

// Adult titles are allowed everywhere and never isolated, so nothing is filtered
// here and `showAdultContent` is no longer forwarded to the API.
// eslint-disable-next-line import/no-anonymous-default-export
export default {
  getNewReleases: async (options: { type: string; format?: string; sort?: string; showAdultContent?: boolean; status?: string; page?: number; perPage?: number; accessToken?: string }) => homeRequest('getNewReleases', options),
  getReleasingThisWeek: async (options: { type: string; page?: number; showAdultContent?: boolean; accessToken?: string }) => homeRequest('getReleasingThisWeek', options),
  getReleasingByDaysRange: async (options: { type: string; days: 0 | 7 | 30; pageNumber?: number; perPage?: number; showAdultContent?: boolean; accessToken?: string }) => homeRequest('getReleasingByDaysRange', { ...options, page: options.pageNumber }),
  getTrendingMedia: async (options: { sort?: string; showAdultContent?: boolean; accessToken?: string }) => homeRequest('getTrendingMedia', options),
  getMediaForThisFormat: async (options: { type: string; format?: string; sort?: string; status?: string | string[]; pageNumber?: number; perPage?: number; showAdultContent?: boolean; accessToken?: string }) => homeRequest('getMediaForThisFormat', { ...options, page: options.pageNumber }),

  getSeachResults: async ({ query, signal }: { query: string; showAdultContent?: boolean; accessToken?: string; signal?: AbortSignal }) => {
    try {
      const params = new URLSearchParams({ fn: 'search', query: query.trim(), page: '1', perPage: '15' });
      const response = await fetch(`/api/anilist/medias?${params}`, { signal, cache: 'no-store' });
      if (!response.ok) return [];
      return ((await response.json()) as { results?: MediaData[] }).results || [];
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return [];
      return [];
    }
  },
};

export type { MediaData, AiringMediaResult, TrendingMediaResult };
