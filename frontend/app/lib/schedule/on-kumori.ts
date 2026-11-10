// Prompt 33 Part B - the pure half of the "On KumoriTV" rule.
//
// Kept free of `server-only`, Supabase and `next` imports so the decision can be
// unit tested: an episode is playable here when either provider column already
// has at least one entry, which is the same rule the episodes API and the
// sitemap use.

import type { ScheduleItem } from './types';

type EpisodeRow = {
  anilist_id?: number;
  episode_number?: number;
  sub_providers?: unknown;
  dub_providers?: unknown;
};

export type PlayableKey = string;

export const playableKey = (anilistId: number, episode: number): PlayableKey => `${anilistId}:${episode}`;

function providerCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

/** True when this episode row has anything playable attached to it. */
export function rowIsPlayable(row: EpisodeRow): boolean {
  return providerCount(row.sub_providers) > 0 || providerCount(row.dub_providers) > 0;
}

/** Stamps `available` onto the visible week, in place-free fashion. */
export function applyAvailability(items: ScheduleItem[], playable: Set<PlayableKey>): ScheduleItem[] {
  return (items ?? []).map((item) => ({
    ...item,
    available: playable.has(playableKey(item.media.id, item.episode)),
  }));
}

