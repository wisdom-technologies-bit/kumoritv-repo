// The three title languages, and the one place that normalises the spellings that
// reach us: AniList's `ROMAJI | ENGLISH | NATIVE` (plus the `_STYLISED` variants)
// and the lowercase values KumoriTV stores in `profiles.title_language`, the
// `media_title_language` cookie and localStorage.
//
// Pure: no React, no server-only imports, safe in the browser and in route handlers.

export const TITLE_LANGUAGES = ["romaji", "english", "native"] as const;

export type TitleLanguage = (typeof TITLE_LANGUAGES)[number];

/** Default for a visitor who has never chosen: English where an English title
 *  exists, romaji otherwise (the fallback chain in `pickTitle` does that part). */
export const DEFAULT_TITLE_LANGUAGE: TitleLanguage = "english";

/** The cookie the server renders from, and the localStorage key guests use. */
export const TITLE_LANGUAGE_COOKIE = "media_title_language";

export const TITLE_LANGUAGE_LABELS: Record<TitleLanguage, string> = {
  romaji: "Romaji",
  english: "English",
  native: "Native",
};

/**
 * `ROMAJI_STYLISED` -> `romaji`, `English` -> `english`, ` native ` -> `native`.
 * Returns null for anything else, so a caller can fall back deliberately instead
 * of silently writing junk into a `check (title_language in (...))` column.
 */
export function normaliseTitleLanguage(value: unknown): TitleLanguage | null {
  if (typeof value !== "string") return null;

  const base = value.trim().toLowerCase().replace(/_stylised$/, "");

  return (TITLE_LANGUAGES as readonly string[]).includes(base) ? (base as TitleLanguage) : null;
}

/** Normalise with a fallback (default: English). */
export function coerceTitleLanguage(value: unknown, fallback: TitleLanguage = DEFAULT_TITLE_LANGUAGE): TitleLanguage {
  return normaliseTitleLanguage(value) ?? fallback;
}

/** A year: the same ceiling the AniList token cookie uses. */
export const TITLE_LANGUAGE_MAX_AGE = 60 * 60 * 24 * 365;
