// Prompt 35: range rules shared by the clip panel and the API.
//
// One function decides whether a start/end pair is a valid clip, so the panel
// (which also knows the episode duration) and the route (which does not) cannot
// disagree about the length rules.

import {
  CLIP_DEFAULT_SECONDS,
  CLIP_MAX_SECONDS_GUEST,
  CLIP_MAX_SECONDS_USER,
  CLIP_MIN_SECONDS,
} from "./constants";

export type ClipRangeError =
  | "invalid_time"
  | "end_before_start"
  | "too_short"
  | "too_long"
  | "past_duration";

export type ClipRangeResult =
  | { ok: true; start: number; end: number }
  | { ok: false; error: ClipRangeError; message: string };

const round = (value: number) => Math.round(value * 100) / 100;

export type ValidateRangeInput = {
  start: unknown;
  end: unknown;
  /** Episode length when the caller knows it (client only). */
  duration?: number | null;
  /** CLIP_MAX_SECONDS_GUEST or CLIP_MAX_SECONDS_USER. */
  maxSeconds?: number;
};

export function validateClipRange({
  start,
  end,
  duration,
  maxSeconds = CLIP_MAX_SECONDS_GUEST,
}: ValidateRangeInput): ClipRangeResult {
  const from = typeof start === "number" ? start : Number.NaN;
  const to = typeof end === "number" ? end : Number.NaN;

  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < 0) {
    return { ok: false, error: "invalid_time", message: "Enter a start and end time." };
  }
  if (to <= from) {
    return { ok: false, error: "end_before_start", message: "End must be after start." };
  }

  const length = to - from;
  if (length < CLIP_MIN_SECONDS) {
    return {
      ok: false,
      error: "too_short",
      message: `Clips must be at least ${CLIP_MIN_SECONDS} seconds.`,
    };
  }
  if (length > maxSeconds) {
    return {
      ok: false,
      error: "too_long",
      message: `Clips can be up to ${maxSeconds} seconds.`,
    };
  }

  if (
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    to > duration + 0.05
  ) {
    return {
      ok: false,
      error: "past_duration",
      message: "The clip ends after the episode does.",
    };
  }

  return { ok: true, start: round(from), end: round(to) };
}

/**
 * Quick mode: the captured time becomes the start and the end defaults to
 * start + 15 s, never past the episode and never shorter than the minimum.
 * Near the end of an episode the window slides back instead of being refused.
 */
export function quickRange(
  current: unknown,
  duration: unknown,
  maxSeconds: number = CLIP_MAX_SECONDS_GUEST,
): { start: number; end: number } {
  const spot =
    typeof current === "number" && Number.isFinite(current) ? Math.max(0, current) : 0;
  const length = Math.min(CLIP_DEFAULT_SECONDS, maxSeconds);
  const total =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0
      ? duration
      : null;

  if (total === null) {
    return { start: round(spot), end: round(spot + length) };
  }

  // The last `length` seconds are also a valid clip, so slide the window back.
  const start = Math.min(spot, Math.max(0, total - length));
  const end = Math.min(start + length, total);
  if (end - start < CLIP_MIN_SECONDS) {
    const fallbackEnd = Math.min(total, CLIP_MIN_SECONDS);
    return { start: round(Math.max(0, fallbackEnd - CLIP_MIN_SECONDS)), end: round(fallbackEnd) };
  }
  return { start: round(start), end: round(end) };
}

export type RangeBounds = {
  start: number;
  end: number;
  duration?: number | null;
  maxSeconds?: number;
};

/**
 * Moves ONE handle by `delta` seconds and keeps the range valid: the start can
 * never pass the end (minus the minimum) and the end can never pass the episode
 * or the length limit. Handles and nudge buttons both go through this.
 */
export function moveHandle(
  range: { start: number; end: number },
  handle: "start" | "end",
  delta: number,
  { duration, maxSeconds = CLIP_MAX_SECONDS_USER }: Omit<RangeBounds, "start" | "end"> = {},
): { start: number; end: number } {
  const total =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0
      ? duration
      : null;
  const ceiling = total === null ? Number.POSITIVE_INFINITY : total;
  const step = Number.isFinite(delta) ? delta : 0;

  if (handle === "start") {
    const lower = Math.max(0, range.end - maxSeconds);
    const upper = Math.max(0, range.end - CLIP_MIN_SECONDS);
    const start = Math.min(Math.max(range.start + step, lower), upper);
    return { start: round(start), end: round(range.end) };
  }

  const lower = Math.min(ceiling, range.start + CLIP_MIN_SECONDS);
  const upper = Math.min(ceiling, range.start + maxSeconds);
  const end = Math.min(Math.max(range.end + step, lower), upper);
  return { start: round(range.start), end: round(end) };
}
