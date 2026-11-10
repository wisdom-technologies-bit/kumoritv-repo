// Prompt 33 Part B - the shapes the release schedule moves around.
//
// Everything here is plain data: the server fetches it, serialises it into the
// RSC payload, and the client does every time-zone calculation on it. Nothing
// in this file touches the network, the clock or `Intl`, which is what keeps the
// day grouping testable.

export type ScheduleTitle = {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
};

export type ScheduleMedia = {
  id: number;
  idMal?: number | null;
  title: ScheduleTitle;
  coverImage?: {
    large?: string | null;
    extraLarge?: string | null;
    color?: string | null;
  } | null;
  bannerImage?: string | null;
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  duration?: number | null;
  genres?: string[] | null;
  averageScore?: number | null;
  popularity?: number | null;
  isAdult?: boolean;
  countryOfOrigin?: string | null;
  studios?: { nodes?: Array<{ name?: string | null }> | null } | null;
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
};

export type ScheduleItem = {
  /** AniList airingSchedule id (unique per episode). */
  id: number;
  /** Unix seconds. The ONLY time a card is placed by. */
  airingAt: number;
  episode: number;
  media: ScheduleMedia;
  /** True when this exact episode already has playable sources here. */
  available?: boolean;
};

export type ScheduleFetch = {
  items: ScheduleItem[];
  /** false = AniList failed and there was no cached copy to fall back on. */
  ok: boolean;
  /** A copy from a previous successful fetch is what you are looking at. */
  stale?: boolean;
  error?: string;
  fetchedAt: number;
  pages: number;
};

export type PremieringFetch = {
  items: ScheduleMedia[];
  ok: boolean;
  fetchedAt: number;
};

/** The three zones the schedule can be read in. */
export type ScheduleZone = 'local' | 'utc' | 'jst';

export const SCHEDULE_ZONES: ScheduleZone[] = ['local', 'utc', 'jst'];
export const FIXED_ZONES: Record<Exclude<ScheduleZone, 'local'>, string> = {
  utc: 'UTC',
  jst: 'Asia/Tokyo',
};
