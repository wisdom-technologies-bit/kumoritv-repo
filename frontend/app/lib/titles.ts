// Site-wide title rule: everywhere a title is shown to a user it is the English
// title, falling back to romaji, then native. Romaji is never preferred, and the
// native title is only ever shown as the small secondary line on the media page.
//
// This module is pure: no React, no "use client", no imports. AniList returns a
// `title` object, but a few call sites (flattened catalog results, saved
// snapshots) only have a plain string, so both shapes are accepted.

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

export const NOT_AVAILABLE = "Not Available";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The title to display: english -> romaji -> native -> userPreferred.
 * `userPreferred` is last on purpose: AniList fills it with the romaji title for
 * anonymous requests, so it must never win over an english title.
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

/**
 * The small line above the big title on the media page: the native title, with
 * romaji only as a fallback when native is missing.
 */
export function secondaryTitle(title: TitleInput): string {
  if (typeof title === "string") return "";
  if (!title || typeof title !== "object") return "";

  return clean(title.native) || clean(title.romaji);
}
