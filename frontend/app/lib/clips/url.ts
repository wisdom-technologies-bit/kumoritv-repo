// Prompt 35: `t` / `end` on a plain watch URL.
//
// `/watch/{id}?ep={n}&t=42&end=57` plays the same range a `/clip/{code}` does.
// Numbers only, and bad values are IGNORED rather than refused: a stale or
// mangled query string must never stop an episode from opening.

import { CLIP_MIN_SECONDS, WATCH_RANGE_MAX_SECONDS } from "./constants";

export type WatchRange = {
  /** Where playback starts, or null when `t` was absent/unusable. */
  seek: number | null;
  /** The closed range to stop at, or null when only `t` was usable. */
  range: { start: number; end: number } | null;
};

const NUMERIC = /^\d{1,6}(?:\.\d{1,3})?$/;

function readNumber(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!NUMERIC.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads `t` and `end`. `t` alone just seeks. `end` only applies when it is a
 * number after `t` and the range is between the clip minimum and the ceiling;
 * otherwise the player opens at `t` as if no range had been given.
 */
export function parseWatchRange(
  search: { t?: string | string[]; end?: string | string[] } | null | undefined,
  options: { maxSeconds?: number; duration?: number | null } = {},
): WatchRange {
  const maxSeconds = options.maxSeconds ?? WATCH_RANGE_MAX_SECONDS;
  const duration =
    typeof options.duration === "number" && Number.isFinite(options.duration) && options.duration > 0
      ? options.duration
      : null;

  let seek = readNumber(search?.t);
  if (seek === null) return { seek: null, range: null };
  if (duration !== null) seek = Math.min(seek, duration);

  let end = readNumber(search?.end);
  if (end === null) return { seek, range: null };
  if (duration !== null) end = Math.min(end, duration);

  const length = end - seek;
  if (length < CLIP_MIN_SECONDS || length > maxSeconds) return { seek, range: null };

  return { seek, range: { start: seek, end } };
}
