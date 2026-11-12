// Prompt 35: clip time parsing and formatting.
//
// Inputs accept the three shapes a viewer is likely to type:
//   "1:05"      minutes:seconds
//   "01:05:09"  hours:minutes:seconds
//   "65"        plain seconds
//   "65.5"      plain seconds with a fraction
// Output is always `m:ss` so the panel, the page and the metadata agree.

/** Nothing on an episode is longer than a day: anything above is a typo. */
export const MAX_TIME_SECONDS = 24 * 60 * 60;

const COLON_TIME = /^(\d{1,4})(?::(\d{1,2}))?(?::(\d{1,2}))?(?:\.(\d{1,3}))?$/;
const PLAIN_SECONDS = /^\d{1,6}(?:\.\d{1,3})?$/;

/** Two decimals is the column's precision (`numeric(8,2)`); no float noise. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `m:ss` / `h:mm:ss` / plain seconds -> seconds, or null when the text is not a
 * time. Negative, malformed and out-of-range values are all null: callers show
 * one generic "Enter a time like 1:05" message instead of guessing.
 */
export function parseTimeInput(input: unknown): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    const value = round(input);
    return value <= MAX_TIME_SECONDS ? value : null;
  }
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (!raw) return null;

  // Plain seconds ("65", "65.5").
  if (!raw.includes(":")) {
    if (!PLAIN_SECONDS.test(raw)) return null;
    const value = round(Number(raw));
    return Number.isFinite(value) && value <= MAX_TIME_SECONDS ? value : null;
  }

  const match = COLON_TIME.exec(raw);
  if (!match) return null;

  const [, first, second, third, fraction] = match;
  const hasHours = third !== undefined;
  // "1:05" -> 1 minute 5 seconds; "01:05:09" -> 1 h 5 min 9 s.
  const hours = hasHours ? Number(first) : 0;
  const minutes = hasHours ? Number(second) : Number(first);
  const seconds = hasHours ? Number(third) : second !== undefined ? Number(second) : 0;

  if (hasHours && (second === undefined || Number(second) > 59)) return null;
  if (!hasHours && second !== undefined && Number(second) > 59) return null;
  if (seconds > 59) return null;

  const value = round(hours * 3600 + minutes * 60 + seconds + (fraction ? Number(`0.${fraction}`) : 0));
  return value <= MAX_TIME_SECONDS ? value : null;
}

/** Seconds -> "m:ss", always. Minutes are never capped at 59. Never throws. */
export function formatTime(seconds: unknown): string {
  const value =
    typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
      ? Math.floor(seconds)
      : 0;
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** "0:42-0:57" - the exact shape used in the clip title and the end card. */
export function formatRange(start: unknown, end: unknown): string {
  return `${formatTime(start)}-${formatTime(end)}`;
}

/** Whole seconds for display in analytics-free counts (never a time string). */
export function clampToDuration(seconds: number, duration: number | null | undefined): number {
  if (!Number.isFinite(seconds)) return 0;
  const value = Math.max(0, seconds);
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return value;
  return Math.min(value, duration);
}
