// Episode list model shared by the media page and the watch page.
//
// `duration` is always SECONDS here. AniVexa gives minutes (26); the merge in
// app/lib/anivexa/merge.ts converts values <= 300 to seconds, so a stored 1560
// renders as "26m" and never as "26s".

export type EpisodeItem = {
  number: number;
  title: string | null;
  description: string | null;
  image: string | null;
  airDate: string | null;
  /** Seconds. */
  duration: number | null;
  filler: boolean;
  recap: boolean;
  hasSub: boolean;
  hasDub: boolean;
};

export type EpisodeOrder = "asc" | "desc";
export type EpisodeView = "list" | "grid";

export type EpisodeFilters = {
  query?: string;
  order?: EpisodeOrder;
  subOnly?: boolean;
  dubOnly?: boolean;
  hideWatched?: boolean;
};

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const providers = (value: unknown) => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as object).length;
  return 0;
};

/** DB row (snake_case, seconds) -> EpisodeItem. */
export function mapEpisodeRow(row: any): EpisodeItem | null {
  if (!row || typeof row !== "object") return null;
  const number = Number(row.episode_number ?? row.number);
  if (!Number.isInteger(number) || number < 1) return null;
  const duration = Number(row.duration);
  return {
    number,
    title: text(row.title) || null,
    description: text(row.description) || null,
    image: text(row.image_url ?? row.image) || null,
    airDate: text(row.air_date ?? row.airDate) || null,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    filler: row.filler === true,
    recap: row.recap === true,
    hasSub: providers(row.sub_providers ?? row.hasSub) > 0 || row.hasSub === true,
    hasDub: providers(row.dub_providers ?? row.hasDub) > 0 || row.hasDub === true,
  };
}

export function mapEpisodeRows(rows: unknown): EpisodeItem[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => mapEpisodeRow(row))
    .filter((item): item is EpisodeItem => item !== null)
    .sort((a, b) => a.number - b.number);
}

/** 1560 -> "26m", 3720 -> "1h 2m". Never "26s". */
export function formatEpisodeDuration(seconds: number | null | undefined) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  const total = Math.round(value < 60 ? value * 60 : value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

/** Seconds left in an episode, for the Keep Watching card's remaining line. */
export function remainingLabel(
  time: number | null | undefined,
  duration: number | null | undefined,
) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) return "";
  const position = Number(time) || 0;
  const left = Math.max(0, total - position);
  if (left <= 0) return "";
  return `${formatEpisodeDuration(left)} left`;
}

export function displayEpisodeTitle(item: EpisodeItem) {
  return item.title || `Episode ${item.number}`;
}

function matchesQuery(item: EpisodeItem, query: string) {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (/^\d+$/.test(needle)) return String(item.number).includes(needle);
  return (item.title || "").toLowerCase().includes(needle);
}

/** Counts for the "Sub only" / "Dub only" chips. */
export function episodeCounts(items: EpisodeItem[]) {
  return {
    total: items.length,
    sub: items.filter((item) => item.hasSub).length,
    dub: items.filter((item) => item.hasDub).length,
  };
}

/**
 * Search / sort / filter over the FULL list (never only the rendered chunk).
 * Watched episodes are hidden when `hideWatched`, and always come back marked.
 */
export function filterEpisodes(
  items: EpisodeItem[],
  filters: EpisodeFilters = {},
  watched: number[] = [],
): EpisodeItem[] {
  const { query = "", order = "desc", subOnly, dubOnly, hideWatched } = filters;
  const watchedSet = new Set(watched || []);
  return items
    .filter((item) => matchesQuery(item, query))
    .filter((item) => (subOnly ? item.hasSub : true))
    .filter((item) => (dubOnly ? item.hasDub : true))
    .filter((item) => (hideWatched ? !watchedSet.has(item.number) : true))
    .sort((a, b) => (order === "asc" ? a.number - b.number : b.number - a.number));
}

export const EPISODE_CHUNK_SIZE = 10;

export function chunkEpisodes<T>(items: T[], size = EPISODE_CHUNK_SIZE): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** How many items are rendered for a given number of "Show more" clicks. */
export function visibleCount(
  total: number,
  pages: number,
  size = EPISODE_CHUNK_SIZE,
) {
  return Math.min(total, Math.max(0, pages + 1) * size);
}

/** The episode number that follows `episode`, capped at what has aired. */
export function nextEpisodeNumber({
  episode,
  airedEpisodes,
  totalEpisodes,
  format,
}: {
  episode: number;
  airedEpisodes?: number | null;
  totalEpisodes?: number | null;
  format?: string | null;
}) {
  if (format === "MOVIE") return null;
  const limitCandidates = [airedEpisodes, totalEpisodes].filter(
    (value): value is number => Number.isFinite(Number(value)) && Number(value) > 0,
  );
  // For a currently-airing show only the aired episodes exist, so the cap is
  // the highest aired number rather than the announced total.
  const limit = limitCandidates.length ? Math.min(...limitCandidates) : 0;
  const next = episode + 1;
  if (limit && next > limit) return null;
  return next;
}
