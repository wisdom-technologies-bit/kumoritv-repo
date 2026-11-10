// Prompt 33 Part B - which schedule entries survive, and how a card reads.
//
// Pure: no React, no Intl, no network. The server uses the same functions to
// trim the AniList answer before it is cached, the client uses them again for
// the instant filters.

import { displayTitle } from '@/app/lib/titles';
import type { ScheduleItem, ScheduleMedia } from './types';

/** Airing anime only. MUSIC is dropped on purpose (it is not watchable here). */
export const SCHEDULE_FORMATS = ['TV', 'TV_SHORT', 'ONA', 'MOVIE', 'SPECIAL'] as const;
export type ScheduleFormat = (typeof SCHEDULE_FORMATS)[number];

/** The three formats the filter chips expose (the rest fold into "All"). */
export const FILTER_FORMATS: ScheduleFormat[] = ['TV', 'ONA', 'MOVIE'];

export function isScheduleFormat(format: string | null | undefined): boolean {
  return !!format && (SCHEDULE_FORMATS as readonly string[]).includes(format);
}

/** Adult titles follow the site setting, exactly like the rest of the catalog. */
export function filterAdultItems<T extends { media?: { isAdult?: boolean } | null }>(
  items: T[],
  showAdultContent: boolean,
): T[] {
  if (showAdultContent) return items ?? [];
  return (items ?? []).filter((item) => item?.media?.isAdult !== true);
}

/** A media episode airs once. AniList can repeat a row across pages. */
export function dedupeAiring(items: ScheduleItem[]): ScheduleItem[] {
  const seen = new Set<string>();
  const out: ScheduleItem[] = [];
  for (const item of items ?? []) {
    if (!item || !item.media) continue;
    const key = `${item.media.id}:${item.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function sortByAiring(items: ScheduleItem[]): ScheduleItem[] {
  return [...(items ?? [])].sort((a, b) => a.airingAt - b.airingAt || a.media.id - b.media.id);
}

/** One pass: drop unusable rows, drop adult, drop duplicates, sort. */
export function prepareAiringSchedule(
  items: ScheduleItem[],
  { showAdultContent }: { showAdultContent: boolean },
): ScheduleItem[] {
  const usable = (items ?? []).filter(
    (item) =>
      !!item &&
      !!item.media &&
      Number.isFinite(item.airingAt) &&
      Number.isFinite(item.episode) &&
      isScheduleFormat(item.media.format),
  );
  return sortByAiring(dedupeAiring(filterAdultItems(usable, showAdultContent)));
}

/** `TV_SHORT` -> `TV Short`, `ONA` -> `ONA`. */
export function formatChip(format: string | null | undefined): string {
  if (!format) return '';
  if (format === 'TV_SHORT') return 'TV Short';
  return format;
}

/** `Episode 5 of 12`, or `Episode 5` when the total is unknown. */
export function episodeLabel(episode: number, media: Pick<ScheduleMedia, 'episodes'>): string {
  const total = Number(media?.episodes ?? 0);
  if (Number.isFinite(total) && total > 0 && total >= episode) return `Episode ${episode} of ${total}`;
  return `Episode ${episode}`;
}

/** The card title: the repo's one rule (english -> romaji -> native). */
export function scheduleTitle(media: Pick<ScheduleMedia, 'title'>): string {
  return displayTitle(media?.title);
}

/** Everything the search box is allowed to match. */
export function searchIndex(media: ScheduleMedia): string {
  const title = media?.title ?? {};
  return [title.english, title.romaji, title.native, displayTitle(title)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export type ScheduleFilters = {
  scope: 'all' | 'kumori' | 'mylist';
  formats: string[];
  query: string;
  hideAired: boolean;
};

export const DEFAULT_FILTERS: ScheduleFilters = {
  scope: 'all',
  formats: [],
  query: '',
  hideAired: false,
};

export function filterSchedule(
  items: ScheduleItem[],
  filters: Partial<ScheduleFilters>,
  context: { nowUnixSeconds: number; myListIds?: Set<number>; onlyToday?: boolean },
): ScheduleItem[] {
  const { scope = 'all', formats = [], query = '', hideAired = false } = filters;
  const needle = query.trim().toLowerCase();
  const airedCutoff = context.nowUnixSeconds - 30 * 60;

  return (items ?? []).filter((item) => {
    if (scope === 'kumori' && item.available !== true) return false;
    if (scope === 'mylist' && !(context.myListIds?.has(item.media.id) ?? false)) return false;
    if (formats.length && !(item.media.format && formats.includes(item.media.format))) return false;
    if (needle && !searchIndex(item.media).includes(needle)) return false;
    // "Hide aired" is a today-only convenience: yesterday's cards are history.
    if (hideAired && context.onlyToday && item.airingAt < airedCutoff) return false;
    return true;
  });
}

/** The next `count` episodes that have not started yet, soonest first. */
export function upNext(items: ScheduleItem[], nowUnixSeconds: number, count = 6): ScheduleItem[] {
  return (items ?? [])
    .filter((item) => item.airingAt + 30 * 60 > nowUnixSeconds)
    .sort((a, b) => a.airingAt - b.airingAt)
    .slice(0, count);
}

/** Aired in the last 24h AND playable here. */
export function justReleased(items: ScheduleItem[], nowUnixSeconds: number, count = 8): ScheduleItem[] {
  return (items ?? [])
    .filter((item) => item.available === true && item.airingAt <= nowUnixSeconds && item.airingAt > nowUnixSeconds - 86_400)
    .sort((a, b) => b.airingAt - a.airingAt)
    .slice(0, count);
}

/** The first `count` genres, in AniList's own order (most defining first). */
export function topGenres(media: ScheduleMedia, count = 2): string[] {
  return (media?.genres ?? []).filter(Boolean).slice(0, count);
}

/** The main studio name, or '' when AniList has none. */
export function studioName(media: ScheduleMedia): string {
  const nodes = media?.studios?.nodes ?? [];
  return nodes.find((node) => !!node?.name)?.name ?? '';
}

/** `/watch/21?episode=5` - the same destination the media page builds. */
export function watchHref(mediaId: number, episode: number): string {
  return `/watch/${mediaId}?episode=${episode}`;
}

/** The site's existing cover placeholder (the same file MediaCard falls back to). */
export const COVER_PLACEHOLDER = '/photo-placeholder.jpg';
