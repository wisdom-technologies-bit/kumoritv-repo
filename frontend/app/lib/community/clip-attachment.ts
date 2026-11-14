// Prompt 38F: the shape of a clip attachment between the picker and the post.
//
// Pure and client-safe: the composer, the picker and the preview card all use
// these helpers, and the tests pin the labels so the picker row, the preview
// card and the feed card cannot describe the same clip three different ways.
//
// THE ADULT RULE, in one place: `hidden` is not "do not show the title", it is
// "the server did not send a title". Everything below renders null-safe, so a
// masked attachment has nothing to leak even by accident.

import { formatRange, formatTime } from "@/app/lib/clips/time";

export const ADULT_LABEL = "Adult content 18+";
export const ADULT_HIDDEN_TEXT = "Turn on adult content in settings to view";

/** What the composer holds while a clip is attached. */
export type AttachedClip = {
  code: string;
  isAdult: boolean;
  /** True when the viewer's adult-content setting is off and the clip is adult. */
  hidden: boolean;
  animeTitle: string | null;
  anilistId: number | null;
  episode: number | null;
  start: number | null;
  end: number | null;
  /** The clip's own title, when it has one. Never sent for a hidden clip. */
  title?: string | null;
};

/** "1:02-1:17" for an attachment that has a range, "" otherwise. */
export function clipRangeLabel(start: unknown, end: unknown): string {
  if (typeof start !== "number" || typeof end !== "number") return "";
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  return formatRange(start, end);
}

/** "15s" - whole seconds, because a clip is never longer than two minutes. */
export function clipDurationLabel(start: unknown, end: unknown): string {
  if (typeof start !== "number" || typeof end !== "number") return "";
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "";
  const seconds = Math.round(end - start);
  return `${seconds}s`;
}

/** "Frieren: Beyond Journey's End · E12" */
export function clipMetaLabel(animeTitle: unknown, episode: unknown): string {
  const title = typeof animeTitle === "string" ? animeTitle.trim() : "";
  const ep = typeof episode === "number" && Number.isFinite(episode) ? episode : null;
  if (title && ep) return `${title} · E${ep}`;
  if (title) return title;
  if (ep) return `Episode ${ep}`;
  return "";
}

/** The same-origin thumbnail the clip already uses; "" when there is no id. */
export function clipThumbPath(anilistId: unknown, episode: unknown): string {
  const id = typeof anilistId === "number" && Number.isFinite(anilistId) ? Math.trunc(anilistId) : 0;
  const ep = typeof episode === "number" && Number.isFinite(episode) ? Math.trunc(episode) : 0;
  if (id <= 0 || ep <= 0) return "";
  return `/thumb/${id}/${ep}`;
}

/** The public clip page. Never produced for a hidden attachment. */
export function clipHref(clip: Pick<AttachedClip, "code" | "hidden">): string | null {
  if (clip.hidden) return null;
  return `/clip/${clip.code}`;
}

/** A one-line description for a screen reader and for `aria-label`s. */
export function clipAriaLabel(clip: AttachedClip): string {
  if (clip.hidden) return `${ADULT_LABEL}. ${ADULT_HIDDEN_TEXT}.`;
  const meta = clipMetaLabel(clip.animeTitle, clip.episode);
  const range = clipRangeLabel(clip.start, clip.end);
  return [meta, range].filter(Boolean).join(", ") || "Clip attached";
}

/** "1:02" style label for a bare number of seconds (used by the picker rows). */
export function clipStartLabel(start: unknown): string {
  return formatTime(start);
}

/**
 * Reads an attachment out of JSON the server produced - either a
 * `/api/clips/mine` row or the `preview` block of `GET /api/clips/[code]`.
 * Defensive on purpose: a missing field becomes null, and `hidden` is only ever
 * true when the server said so, so a client-side mistake cannot reveal a clip
 * the server chose to mask.
 */
export function readAttachmentFromPreview(raw: unknown): AttachedClip {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const num = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    code: typeof row.code === "string" ? row.code : "",
    isAdult: row.isAdult === true,
    hidden: row.hidden === true,
    animeTitle: text(row.animeTitle),
    anilistId: num(row.anilistId),
    episode: num(row.episode),
    start: num(row.start),
    end: num(row.end),
    title: text(row.title),
  };
}
