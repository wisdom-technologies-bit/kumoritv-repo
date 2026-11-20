// The one rule for which title a surface shows.
//
// Pure: no React, no server imports, no network. Every surface (cards, headings,
// rails, search, notifications, share text) goes through `pickTitle`, so the
// preference behaves the same everywhere.
//
// AniList returns a `title` object, but a few call sites (flattened catalog
// results, saved snapshots) only have a plain string, so both shapes are accepted.

import { DEFAULT_TITLE_LANGUAGE, normaliseTitleLanguage, type TitleLanguage } from "./language";

export { DEFAULT_TITLE_LANGUAGE, TITLE_LANGUAGES, normaliseTitleLanguage, coerceTitleLanguage } from "./language";
export type { TitleLanguage } from "./language";

export type TitleInput =
  | string
  | null
  | undefined
  | {
      english?: string | null;
      romaji?: string | null;
      native?: string | null;
      userPreferred?: string | null;
    };

export type TitleFields = {
  english: string;
  romaji: string;
  native: string;
};

/** What a title that has no text at all shows. */
export const UNTITLED = "Untitled";

/** Legacy name kept for the call sites that still import it. */
export const NOT_AVAILABLE = "Not Available";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The three strings, cleaned, with no fallback applied. */
export function titleFields(title: TitleInput): TitleFields {
  if (typeof title === "string") return { english: clean(title), romaji: "", native: "" };
  if (!title || typeof title !== "object") return { english: "", romaji: "", native: "" };

  return {
    english: clean(title.english),
    romaji: clean(title.romaji),
    native: clean(title.native),
  };
}

/**
 * The fallback chain: the chosen language, then English, then romaji, then
 * native, then "Untitled". Native is special-cased: a missing native title falls
 * straight to romaji, which is the Japanese name a native reader recognises.
 */
export function pickTitle(
  titles: TitleInput,
  preference: TitleLanguage | string | null | undefined = DEFAULT_TITLE_LANGUAGE
): string {
  const fields = titleFields(titles);
  const wanted = normaliseTitleLanguage(preference) ?? DEFAULT_TITLE_LANGUAGE;
  const chain: TitleLanguage[] =
    wanted === "native" ? ["native", "romaji", "english"] : [wanted, "english", "romaji", "native"];

  for (const language of chain) {
    const value = fields[language];

    if (value) return value;
  }

  // Older saved rows only carry AniList's `userPreferred`; use it before giving up.
  const userPreferred = typeof titles === "object" && titles ? clean(titles.userPreferred) : "";

  return userPreferred || UNTITLED;
}

/** The same rule for a list, so rails and grids never diverge. */
export function pickTitles<T>(
  items: readonly T[],
  preference: TitleLanguage | string | null | undefined,
  getTitles: (item: T) => TitleInput
): string[] {
  return items.map((item) => pickTitle(getTitles(item), preference));
}

/**
 * The secondary line some cards and the media page show: the other name for the
 * same work. With a native preference it is romaji, otherwise native.
 */
export function alternativeTitle(
  titles: TitleInput,
  preference: TitleLanguage | string | null | undefined = DEFAULT_TITLE_LANGUAGE
): string {
  const fields = titleFields(titles);
  const wanted = normaliseTitleLanguage(preference) ?? DEFAULT_TITLE_LANGUAGE;

  if (wanted === "native") return fields.romaji || fields.english;

  return fields.native || fields.romaji;
}

/** All three renderings, each already resolved through its own fallback chain. */
export function titleVariants(titles: TitleInput): TitleFields {
  return {
    romaji: pickTitle(titles, "romaji"),
    english: pickTitle(titles, "english"),
    native: pickTitle(titles, "native"),
  };
}

/**
 * Kept for call sites that need a STRING (alt text, aria-label, template copy)
 * and for older code: the default rendering, English first, `userPreferred` last
 * (AniList fills it with the romaji title for anonymous requests, so it must
 * never win over English). New visible titles use `pickTitle`/`<AnimeTitle>`.
 */
export function displayTitle(title: TitleInput): string {
  if (typeof title === "string") return clean(title) || NOT_AVAILABLE;
  if (!title || typeof title !== "object") return NOT_AVAILABLE;

  return (
    clean(title.english) ||
    clean(title.romaji) ||
    clean(title.native) ||
    clean(title.userPreferred) ||
    NOT_AVAILABLE
  );
}

export function secondaryTitle(title: TitleInput): string {
  if (typeof title === "string") return "";

  return alternativeTitle(title, DEFAULT_TITLE_LANGUAGE);
}

/**
 * Search is a different rule from display: it matches every known name, whatever
 * the viewer's preference, so an English-preferring visitor still finds
 * "Shingeki no Kyojin". AniList's own search already does this server side; this
 * is for the local filters (clips, saved snapshots, recent searches).
 */
export function matchesTitleQuery(
  titles: TitleInput,
  query: string,
  synonyms: readonly (string | null | undefined)[] = []
): boolean {
  const needle = query.trim().toLowerCase();

  if (!needle) return false;

  const fields = titleFields(titles);
  const haystack = [fields.english, fields.romaji, fields.native, ...synonyms]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  return haystack.some((value) => value.includes(needle));
}

export function filterByTitleQuery<T>(
  items: readonly T[],
  query: string,
  getTitles: (item: T) => TitleInput,
  getSynonyms?: (item: T) => readonly (string | null | undefined)[]
): T[] {
  return items.filter((item) => matchesTitleQuery(getTitles(item), query, getSynonyms?.(item) ?? []));
}
