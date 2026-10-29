// Skip Intro / Outro / Recap ranges.
//
// Provider ranges (AniVexa per-stream `intro` / `outro`, in seconds) and the
// AniSkip ranges are merged into one set. Provider data wins on overlap.
// Invalid ranges are dropped: end <= start (this includes senshi's {0,0}),
// non-finite numbers, or a start beyond the episode duration. A range that
// starts at 0 is valid (reanime's intro is {0, 90}).

export type SkipRange = { start: number; end: number } | null;
export type SkipKey = "recap" | "intro" | "outro";
export type SkipRanges = {
  intro: SkipRange;
  outro: SkipRange;
  recap: SkipRange;
};

export const SKIP_KEYS: SkipKey[] = ["recap", "intro", "outro"];

export const SKIP_LABELS: Record<SkipKey, string> = {
  recap: "Skip Recap",
  intro: "Skip Intro",
  outro: "Skip Outro",
};

export function skipLabel(key: string) {
  return SKIP_LABELS[key as SkipKey] || "Skip";
}

function valid(range: SkipRange, duration?: number | null): SkipRange {
  if (
    !range ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.end <= range.start ||
    range.start < 0
  )
    return null;
  // A start past the end of the episode can never be reached.
  if (
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    range.start >= duration
  )
    return null;
  return { start: range.start, end: range.end };
}

/**
 * Provider ranges first (they win on overlap), then AniSkip.
 * `duration` (seconds) is optional: when known, unmatchable ranges are dropped.
 */
export function mergeSkipRanges(
  providerRanges: Partial<SkipRanges> = {},
  aniskipRanges: Partial<SkipRanges> = {},
  duration?: number | null,
): SkipRanges {
  return {
    intro:
      valid(providerRanges.intro ?? null, duration) ||
      valid(aniskipRanges.intro ?? null, duration),
    outro:
      valid(providerRanges.outro ?? null, duration) ||
      valid(aniskipRanges.outro ?? null, duration),
    recap:
      valid(providerRanges.recap ?? null, duration) ||
      valid(aniskipRanges.recap ?? null, duration),
  };
}

/** True while the button for this range should be on screen. */
export function isSkipVisible(currentTime: number, range: SkipRange) {
  if (!range || !Number.isFinite(currentTime)) return false;
  return currentTime >= range.start - 1 && currentTime <= range.end - 2;
}

export function shouldAutoSkip(
  key: string,
  skipped: Set<string>,
  range: SkipRange,
  currentTime: number,
) {
  return Boolean(
    range && !skipped.has(key) && isSkipVisible(currentTime, range),
  );
}

/** The range the button should show right now, if any. */
export function visibleSkipRange(
  currentTime: number,
  ranges: Partial<SkipRanges> | null | undefined,
): { key: SkipKey; range: { start: number; end: number } } | null {
  if (!ranges) return null;
  for (const key of SKIP_KEYS) {
    const range = ranges[key];
    if (range && isSkipVisible(currentTime, range))
      return { key, range: { start: range.start, end: range.end } };
  }
  return null;
}
