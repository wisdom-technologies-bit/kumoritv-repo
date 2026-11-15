// Prompt 40: the Adcash in-stream (pre-roll) ad - configuration, eligibility,
// browser storage and the circuit breaker.
//
// Framework-free on purpose: the watch page reads the flags on the SERVER and
// passes them down as props, the player decides eligibility in the browser from
// those props plus localStorage. Every rule here is a pure function so the unit
// tests need no browser.
//
// Nothing in this file runs while the flags are off, and the flag default is off:
// PREROLL_ENABLED unset/0 or ADCASH_VAST_URL empty means the player never mounts
// the overlay, never loads a third-party script and never makes a request.

export type PrerollConfig = {
  enabled: boolean;
  vastUrl: string;
  intervalMin: number;
  skipAfterSec: number;
  maxAdSec: number;
  startTimeoutMs: number;
  vastTimeoutMs: number;
};

export const PREROLL_DEFAULTS = {
  intervalMin: 20,
  skipAfterSec: 5,
  maxAdSec: 30,
  startTimeoutMs: 6000,
  vastTimeoutMs: 4000,
} as const;

/** The skip button may never wait longer than this, whatever the config says. */
export const PREROLL_MAX_SKIP_SEC = 10;
/** A viewer who resumes past this point arrived mid-episode: no pre-roll. */
export const PREROLL_RESUME_GRACE_SEC = 30;
/** Auto-next right after a pre-roll does not get a second one. */
export const PREROLL_AUTOPLAY_GAP_MS = 5 * 60 * 1000;
export const PREROLL_BREAKER_FAILURES = 3;
export const PREROLL_BREAKER_WINDOW_MS = 10 * 60 * 1000;
export const PREROLL_BREAKER_OPEN_MS = 30 * 60 * 1000;

export const PREROLL_STORAGE_KEYS = {
  lastAdAt: "kumori:preroll:last",
  tabAdAt: "kumori:preroll:tab",
  breaker: "kumori:preroll:breaker",
} as const;

function intFrom(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number.parseInt(String(raw ?? "").trim(), 10);

  if (!Number.isFinite(value)) return fallback;

  return Math.min(Math.max(value, min), max);
}

function isOn(raw: string | undefined) {
  return ["1", "true", "on", "yes"].includes(String(raw ?? "").trim().toLowerCase());
}

/**
 * Request-time config. `enabled` is the single gate: it needs BOTH the flag and a
 * tag, so clearing either one turns the feature off without a code change.
 */
export function readPrerollConfig(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): PrerollConfig {
  const vastUrl = String(env.ADCASH_VAST_URL ?? "").trim();
  const usableTag = /^https:\/\//i.test(vastUrl);
  const flag = isOn(env.PREROLL_ENABLED);

  return {
    enabled: Boolean(flag && usableTag),
    vastUrl: usableTag ? vastUrl : "",
    intervalMin: intFrom(env.PREROLL_INTERVAL_MIN, PREROLL_DEFAULTS.intervalMin, 0, 24 * 60),
    // Never above 10s, per the owner: a pre-roll may not hold the viewer hostage.
    skipAfterSec: intFrom(env.PREROLL_SKIP_AFTER_SEC, PREROLL_DEFAULTS.skipAfterSec, 0, PREROLL_MAX_SKIP_SEC),
    maxAdSec: intFrom(env.PREROLL_MAX_AD_SEC, PREROLL_DEFAULTS.maxAdSec, 5, 120),
    startTimeoutMs: intFrom(env.PREROLL_START_TIMEOUT_MS, PREROLL_DEFAULTS.startTimeoutMs, 500, 30000),
    vastTimeoutMs: intFrom(env.PREROLL_VAST_TIMEOUT_MS, PREROLL_DEFAULTS.vastTimeoutMs, 500, 20000),
  };
}

/** What the server hands the client. No key ever travels this way; the tag is not a secret but stays out of the repo. */
export type PrerollClientConfig = PrerollConfig & {
  /** Signed-in owner/admin (public.staff_roles): never see ads. */
  isStaff: boolean;
  /** Adult title while the viewer has not opted in (that page is hidden anyway). */
  adultBlocked: boolean;
};

export type PrerollEligibilityInput = {
  config: PrerollConfig;
  isEmbed: boolean;
  /** Saved progress in seconds; resuming mid-episode is not a fresh play. */
  resumeAtSec: number;
  isStaff: boolean;
  adultBlocked: boolean;
  now: number;
  lastAdAt: number | null;
  /** This tab already showed its one ad (a second tab must not double it). */
  tabAdAt: number | null;
  breakerOpenUntil: number | null;
  /** When the previous pre-roll ran before an auto-next. */
  lastAutoplayAdAt?: number | null;
};

export type PrerollEligibility =
  | { ok: true }
  | { ok: false; reason: PrerollSkipReason };

export type PrerollSkipReason =
  | "flag_off"
  | "no_tag"
  | "embed"
  | "staff"
  | "adult"
  | "resume"
  | "interval"
  | "tab"
  | "autoplay"
  | "breaker";

/**
 * Every condition must hold. Order matters only for the log line: the first
 * failing reason is the one recorded.
 */
export function prerollEligibility(input: PrerollEligibilityInput): PrerollEligibility {
  const { config, now } = input;

  if (!config.enabled) return { ok: false, reason: config.vastUrl ? "flag_off" : "no_tag" };
  if (input.isEmbed) return { ok: false, reason: "embed" };
  if (input.isStaff) return { ok: false, reason: "staff" };
  if (input.adultBlocked) return { ok: false, reason: "adult" };
  if (Number(input.resumeAtSec) > PREROLL_RESUME_GRACE_SEC) return { ok: false, reason: "resume" };
  if (input.breakerOpenUntil && input.breakerOpenUntil > now) return { ok: false, reason: "breaker" };
  if (input.tabAdAt) return { ok: false, reason: "tab" };

  if (config.intervalMin > 0 && input.lastAdAt) {
    if (now - input.lastAdAt < config.intervalMin * 60 * 1000) return { ok: false, reason: "interval" };
    // An auto-next within the gap is covered by the interval rule; without an
    // interval the explicit 5 minute autoplay gap still applies.
    if (input.lastAutoplayAdAt && now - input.lastAutoplayAdAt < PREROLL_AUTOPLAY_GAP_MS) {
      return { ok: false, reason: "autoplay" };
    }
  }
  if (
    config.intervalMin <= 0 &&
    input.lastAutoplayAdAt &&
    now - input.lastAutoplayAdAt < PREROLL_AUTOPLAY_GAP_MS
  ) {
    return { ok: false, reason: "autoplay" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------- storage

export type BreakerState = { failures: number[]; openUntil: number | null };

export type PrerollStore = {
  lastAdAt: number | null;
  tabAdAt: number | null;
  breaker: BreakerState;
};

const EMPTY_BREAKER: BreakerState = { failures: [], openUntil: null };

function readJson(key: string, storage: "local" | "session"): unknown {
  try {
    const raw = (storage === "local" ? globalThis.localStorage : globalThis.sessionStorage)?.getItem(key);

    if (!raw) return null;

    return JSON.parse(raw);
  } catch {
    // Private mode, disabled storage, a corrupted value: "no memory", never a crash.
    return null;
  }
}

function writeJson(key: string, value: unknown, storage: "local" | "session") {
  try {
    (storage === "local" ? globalThis.localStorage : globalThis.sessionStorage)?.setItem(
      key,
      JSON.stringify(value),
    );

    return true;
  } catch {
    return false;
  }
}

function asTime(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function readPrerollStore(): PrerollStore {
  const lastAdAt = asTime(readJson(PREROLL_STORAGE_KEYS.lastAdAt, "local"));
  const tabAdAt = asTime(readJson(PREROLL_STORAGE_KEYS.tabAdAt, "session"));
  const breaker = readJson(PREROLL_STORAGE_KEYS.breaker, "local") as BreakerState | null;

  return {
    lastAdAt,
    tabAdAt,
    breaker:
      breaker && Array.isArray(breaker.failures)
        ? { failures: breaker.failures.filter((n) => Number.isFinite(n)), openUntil: asTime(breaker.openUntil) }
        : { ...EMPTY_BREAKER },
  };
}

/** Records that a pre-roll actually played (used by the interval cap). */
export function writePrerollAdShown(now: number, opts: { autoplay?: boolean } = {}) {
  writeJson(PREROLL_STORAGE_KEYS.lastAdAt, now, "local");
  writeJson(PREROLL_STORAGE_KEYS.tabAdAt, now, "session");

  if (opts.autoplay) writeJson("kumori:preroll:autoplay", now, "local");
}

export function readPrerollAutoplayAt(): number | null {
  return asTime(readJson("kumori:preroll:autoplay", "local"));
}

export function writePrerollBreaker(state: BreakerState) {
  writeJson(PREROLL_STORAGE_KEYS.breaker, state, "local");
}

export function isPrerollBreakerOpen(state: BreakerState, now: number) {
  return Boolean(state.openUntil && state.openUntil > now);
}

/**
 * Three failures inside ten minutes open the breaker for thirty. Only failures
 * count - a no-fill is a normal outcome, not a broken ad stack.
 */
export function registerPrerollFailure(state: BreakerState, now: number): BreakerState {
  const failures = [...state.failures.filter((at) => now - at < PREROLL_BREAKER_WINDOW_MS), now];

  if (failures.length >= PREROLL_BREAKER_FAILURES) {
    return { failures, openUntil: now + PREROLL_BREAKER_OPEN_MS };
  }

  return { failures, openUntil: null };
}

export function registerPrerollSuccess(): BreakerState {
  return { ...EMPTY_BREAKER, failures: [] };
}

// --------------------------------------------------------------- counters

export type PrerollCounters = {
  requests: number;
  noFill: number;
  started: number;
  completed: number;
  skipped: number;
  errored: number;
  byReason: Record<string, number>;
};

const freshCounters = (): PrerollCounters => ({
  requests: 0,
  noFill: 0,
  started: 0,
  completed: 0,
  skipped: 0,
  errored: 0,
  byReason: {},
});

let counters = freshCounters();

/**
 * In-memory session counters. The project has no client-event endpoint to post to
 * (Google Analytics is a pageview script, Vercel Analytics is automatic), so
 * nothing is sent anywhere: `window.__kumoriPreroll` exposes the set for a support
 * session and the tests read it.
 */
export function recordPrerollCount(kind: keyof Omit<PrerollCounters, "byReason">, reason?: string) {
  counters = { ...counters, [kind]: counters[kind] + 1 };

  if (reason) {
    counters.byReason = { ...counters.byReason, [reason]: (counters.byReason[reason] || 0) + 1 };
  }
  try {
    (globalThis as any).__kumoriPreroll = counters;
  } catch {
    /* nothing to expose */
  }
}

export function getPrerollCounters(): PrerollCounters {
  return counters;
}

export function resetPrerollCounters() {
  counters = freshCounters();
}

/** The single log line for an outcome. Never a URL: the tag carries a request id. */
export function logPrerollOutcome(outcome: { kind: string; reason?: string; ms: number }) {
  // eslint-disable-next-line no-console
  console.info(
    `preroll_outcome kind=${outcome.kind} reason=${outcome.reason || "none"} ms=${Math.max(0, Math.round(outcome.ms))}`,
  );
}
