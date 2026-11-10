import 'server-only';
// Prompt 33 Part B - "On KumoriTV" without a single external call per card.
//
// One batched read of `public.episodes` for the whole visible week: an episode
// counts as playable when either provider column has at least one entry, which
// is the same rule `app/api/anime/[anilistId]/episodes` and the sitemap use.
// Columns are the ones that already exist in supabase/migrations/core.sql - no
// invented ones, and Anivexa is never called from here.

import { createAdminClient } from '@/app/lib/supabase/admin';
import type { ScheduleItem } from './types';

/** PostgREST answers at most 1000 rows per request, whatever the range asks. */
const ROW_PAGE_SIZE = 1000;
/** Episode rows for this many titles are read in one round of requests. */
const ID_CHUNK = 60;

import { applyAvailability, playableKey, rowIsPlayable, type PlayableKey } from './on-kumori';

export type { PlayableKey } from './on-kumori';
export { applyAvailability, playableKey, rowIsPlayable } from './on-kumori';

type EpisodeRow = {
  anilist_id: number;
  episode_number: number;
  sub_providers: unknown;
  dub_providers: unknown;
};

/**
 * Every `anilist_id:episode` that is already playable here.
 *
 * `ids` and `episodes` are the visible week only, so the read stays small. A
 * missing Supabase configuration (or a failed read) returns an empty set: the
 * page then simply shows "Coming" instead of breaking.
 */
export async function readPlayableEpisodes(ids: number[], episodes: Set<number> = new Set()): Promise<Set<PlayableKey>> {
  const playable = new Set<PlayableKey>();
  const anilistIds = [...new Set((ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!anilistIds.length) return playable;

  const db = createAdminClient() as unknown as { from: (table: string) => any } | null;
  if (!db) return playable;

  for (let start = 0; start < anilistIds.length; start += ID_CHUNK) {
    const chunk = anilistIds.slice(start, start + ID_CHUNK);
    for (let offset = 0; ; offset += ROW_PAGE_SIZE) {
      let rows: EpisodeRow[] = [];
      try {
        const { data, error } = await db
          .from('episodes')
          .select('anilist_id,episode_number,sub_providers,dub_providers')
          .in('anilist_id', chunk)
          .range(offset, offset + ROW_PAGE_SIZE - 1);
        if (error) throw error;
        rows = (data ?? []) as EpisodeRow[];
      } catch {
        return playable;
      }

      for (const row of rows) {
        const number = Number(row.episode_number);
        if (!Number.isFinite(number)) continue;
        if (episodes.size && !episodes.has(number)) continue;
        if (rowIsPlayable(row)) playable.add(playableKey(Number(row.anilist_id), number));
      }

      if (rows.length < ROW_PAGE_SIZE) break;
    }
  }

  return playable;
}

/** The batched read the page needs, in one call. */
export async function markOnKumoriTV(items: ScheduleItem[]): Promise<ScheduleItem[]> {
  if (!items?.length) return items ?? [];
  const ids = items.map((item) => item.media?.id).filter((id): id is number => Number.isFinite(id));
  const episodes = new Set(items.map((item) => item.episode));
  const playable = await readPlayableEpisodes(ids, episodes);
  return applyAvailability(items, playable);
}
