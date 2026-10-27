// Title, description and canonical builders for the public pages. Pure and
// deterministic so the metadata can be unit tested without Next.

import { absoluteUrl, isGenericEpisodeTitle, stripHtml, truncate } from "./text";

/** Brand-free title budget: the root layout appends " | KumoriTV" itself. */
export const MAX_TITLE_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 160;

export type AnimeTitleFields = {
  english?: string | null;
  romaji?: string | null;
  native?: string | null;
  userPreferred?: string | null;
};

/** Watch/media pages show the English name first, then romaji. */
export function animeName(title: AnimeTitleFields | null | undefined): string {
  if (!title) return "";
  const candidates = [title.english, title.romaji, title.userPreferred, title.native];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (value) return value;
  }
  return "";
}

/** Any episode-ish input becomes a positive integer, defaulting to 1. */
export function parseEpisodeNumber(value: unknown, format?: string | null): number {
  if (typeof format === "string" && format.toUpperCase() === "MOVIE") return 1;
  const raw = typeof value === "string" ? value.trim() : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  const whole = Math.trunc(parsed);
  if (whole < 1 || whole > 99999) return 1;
  return whole;
}

function usableEpisodeTitle(title: unknown): string {
  if (typeof title !== "string") return "";
  const value = title.replace(/\s+/g, " ").trim();
  if (isGenericEpisodeTitle(value)) return "";
  return value;
}

export type WatchTitleInput = {
  animeName: string;
  episode?: unknown;
  episodeTitle?: unknown;
  format?: string | null;
};

/**
 * `Watch One Piece Episode 1089: A New Era` (no brand suffix).
 * The anime name is truncated first so the part before the brand stays ~60 chars.
 */
export function buildWatchTitle(input: WatchTitleInput): string {
  const name = (input.animeName || "").trim() || "Anime";
  const isMovie = typeof input.format === "string" && input.format.toUpperCase() === "MOVIE";
  if (isMovie) {
    const budget = Math.max(10, MAX_TITLE_LENGTH - "Watch ".length - " (Movie)".length);
    return `Watch ${truncate(name, budget)} (Movie)`;
  }
  const episode = parseEpisodeNumber(input.episode, input.format);
  const suffix = ` Episode ${episode}`;
  const lead = "Watch ";
  const title = usableEpisodeTitle(input.episodeTitle);
  if (!title) {
    return `${lead}${truncate(name, Math.max(10, MAX_TITLE_LENGTH - lead.length - suffix.length))}${suffix}`;
  }
  const overhead = lead.length + suffix.length + ": ".length;
  const reservedTitle = Math.min(title.length, 26);
  const nameBudget = Math.max(10, MAX_TITLE_LENGTH - overhead - reservedTitle);
  const shortName = truncate(name, nameBudget);
  const titleBudget = MAX_TITLE_LENGTH - lead.length - shortName.length - suffix.length - ": ".length;
  if (titleBudget < 6) return `${lead}${shortName}${suffix}`;
  return `${lead}${shortName}${suffix}: ${truncate(title, titleBudget)}`;
}

export type WatchDescriptionInput = {
  animeName: string;
  episode?: unknown;
  episodeTitle?: unknown;
  hasSub?: boolean;
  hasDub?: boolean;
  synopsis?: unknown;
  format?: string | null;
};

/** " with English subtitles" and/or " and dubbed", only when available. */
export function buildAudioPhrase(hasSub: unknown, hasDub: unknown): string {
  if (hasSub && hasDub) return " with English subtitles and dubbed";
  if (hasSub) return " with English subtitles";
  if (hasDub) return " and dubbed";
  return "";
}

export function buildWatchDescription(input: WatchDescriptionInput): string {
  const name = (input.animeName || "").trim() || "this anime";
  const episode = parseEpisodeNumber(input.episode, input.format);
  const isMovie = typeof input.format === "string" && input.format.toUpperCase() === "MOVIE";
  const title = usableEpisodeTitle(input.episodeTitle);
  const quoted = title ? ` "${title}"` : "";
  const where = isMovie ? `Watch ${name} (Movie)` : `Watch ${name} Episode ${episode}${quoted}`;
  const head = `${where} online${buildAudioPhrase(input.hasSub, input.hasDub)}.`;
  const synopsis = stripHtml(input.synopsis);
  const combined = synopsis ? `${head} ${synopsis}` : head;
  return truncate(combined.replace(/\s+/g, " ").trim(), MAX_DESCRIPTION_LENGTH);
}

/** Canonical watch URL: the episode is the only ranking parameter that survives. */
export function buildWatchCanonical(id: string | number, episode?: unknown, format?: string | null): string {
  const numeric = Number(id);
  const safeId = Number.isInteger(numeric) && numeric > 0 ? String(numeric) : String(id ?? "").trim();
  return `${absoluteUrl(`/watch/${safeId}`)}?ep=${parseEpisodeNumber(episode, format)}`;
}

export function buildMediaCanonical(id: string | number): string {
  const numeric = Number(id);
  const safeId = Number.isInteger(numeric) && numeric > 0 ? String(numeric) : String(id ?? "").trim();
  return absoluteUrl(`/media/${safeId}`);
}

export function buildMediaTitle(input: { animeName: string; year?: unknown }): string {
  const name = (input.animeName || "").trim() || "Anime";
  const year = Number(input.year);
  const withYear = Number.isInteger(year) && year > 1900 && year < 2200 ? `${name} (${year})` : name;
  return `${withYear} - Watch Online, Episodes & Info`;
}

export function buildMediaDescription(input: { description?: unknown; animeName?: string }): string {
  const stripped = stripHtml(input.description);
  if (stripped) return truncate(stripped, MAX_DESCRIPTION_LENGTH);
  const name = (input.animeName || "").trim() || "this anime";
  return truncate(
    `${name} on KumoriTV: synopsis, genres, episode list, ratings and where to watch every episode online.`,
    MAX_DESCRIPTION_LENGTH,
  );
}
