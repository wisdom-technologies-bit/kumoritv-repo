import "server-only";
import { assertSafeUpstream } from "@/app/lib/proxy/upstream";
import { aniConfig, type AniConfig } from "./config";
import {
  AniProviderError,
  PERMANENT_MAL_REASONS,
  reasonForErrorCode,
  upstreamErrorCode,
  type AniReason,
} from "./errors";
import type { AniStreamResponse } from "./types";

/**
 * The only way this app talks to ani-api.
 *
 * Everything the prompt asks for before a single byte reaches a viewer is here:
 * a 10 minute positive cache (upstream URLs live ~28 minutes, so it is never
 * longer), negative caching so a title with no mapping is not re-asked on every
 * request, single flight so ten viewers of one episode cost one upstream call,
 * a circuit breaker, the 429 pause, and a token bucket plus concurrency cap that
 * keep us under the API's 60 requests/minute per key. When the limiter is
 * saturated the provider is SKIPPED - viewers are never queued behind it.
 *
 * The API key is read per call from `ANI_API_KEY`, used as a request header and
 * never stored anywhere else: not in a cache entry, not in a result object, not
 * in a message, not in a token.
 */

export const ANI_UPSTREAM_HOSTS = ["dramahot.top", "drama1.cfd"];

const POSITIVE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_LONG_MS = 30 * 60_000;
const NEGATIVE_TTL_SHORT_MS = 60_000;
const CACHE_LIMIT = 500;
const BREAKER_WINDOW_MS = 60_000;
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
/** One line of the debug trace; reason codes only, never upstream text. */
export type AniTraceEntry = {
  provider: string;
  outcome: "success" | "failed" | "skipped";
  reason?: string;
  ms: number;
};

const OUTCOME_LIMIT = 20;

export type AniStreamSuccess = {
  ok: true;
  stream: AniStreamResponse;
  cached: boolean;
  ms: number;
};

export type AniStreamFailure = {
  ok: false;
  reason: AniReason;
  ms: number;
};

export type AniStreamResult = AniStreamSuccess | AniStreamFailure;

export type AniOutcomeRecord = {
  at: string;
  outcome: "ok" | "failed" | "skipped" | "fallback_to_anivexa";
  reason?: AniReason;
  ms: number;
};

// ---------------------------------------------------------------------------
// Module state. One copy per server process, which is exactly the granularity
// of a per-key rate limit and of "is the provider healthy right now".
// ---------------------------------------------------------------------------

type CacheEntry = { at: number; ttl: number; result: AniStreamResult };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AniStreamResult>>();

let failureTimes: number[] = [];
let openUntil = 0;
let pausedUntil = 0;

let tokens = 0;
let lastRefill = 0;
let active = 0;

const outcomes: AniOutcomeRecord[] = [];
const counters = new Map<string, number>();

const now = () => Date.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cacheKey = (malId: number, episode: number, audio: string) =>
  `${malId}:${episode}:${audio}`;

function readCache(key: string): AniStreamResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now() - entry.at >= entry.ttl) {
    cache.delete(key);
    return null;
  }
  // LRU touch: re-inserting moves the key to the end of the iteration order.
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

function writeCache(key: string, result: AniStreamResult, ttl: number) {
  cache.delete(key);
  cache.set(key, { at: now(), ttl, result });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** How long a negative answer is worth remembering. 0 means "do not cache". */
export function negativeTtlMs(reason: AniReason): number {
  if (PERMANENT_MAL_REASONS.includes(reason)) return NEGATIVE_TTL_LONG_MS;
  if (
    reason === "mal_episode_mismatch" ||
    reason === "mal_title_source" ||
    reason === "upstream_error" ||
    reason === "invalid_body" ||
    reason === "http_error"
  )
    return NEGATIVE_TTL_SHORT_MS;
  // auth, rate_limited, timeout, network_error, breaker_open, paused, saturated
  // and the validation failures are either provider-wide or request-specific:
  // caching them would hide a recovery for up to half an hour.
  return 0;
}

function breakerIsOpen(at = now()) {
  return openUntil > at;
}

function recordBreakerFailure(at = now()) {
  failureTimes = failureTimes.filter((time) => at - time < BREAKER_WINDOW_MS);
  failureTimes.push(at);
  if (failureTimes.length >= BREAKER_THRESHOLD) {
    openUntil = at + BREAKER_COOLDOWN_MS;
    failureTimes = [];
  }
}

function recordBreakerSuccess() {
  failureTimes = [];
}

function takeToken(config: AniConfig, at = now()) {
  if (!lastRefill) {
    tokens = config.ratePerMin;
    lastRefill = at;
  }
  const elapsed = at - lastRefill;
  if (elapsed > 0) {
    tokens = Math.min(
      config.ratePerMin,
      tokens + (elapsed * config.ratePerMin) / 60_000,
    );
    lastRefill = at;
  }
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}

function fail(reason: AniReason, started: number): AniStreamFailure {
  return { ok: false, reason, ms: now() - started };
}

/** Is this URL a host the ani-api actually produces? */
export function isAllowedUpstreamUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase().replace(/[\[\]]/g, "");
  const listed = ANI_UPSTREAM_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
  if (!listed) return false;
  try {
    // The app's own private-address guard, reused rather than re-implemented.
    assertSafeUpstream(value);
  } catch {
    return false;
  }
  return true;
}

/**
 * Everything the response must prove before it may be used. Anything else means
 * "skip ani for this request": an unverified stream is never guessed at.
 */
export function validateAniStream(
  body: unknown,
  input: { malId: number; episode: number; started: number },
): AniStreamResult {
  // Nothing here trusts the shape: the body is whatever the API sent.
  const stream = (body && typeof body === "object" ? body : {}) as Partial<AniStreamResponse>;
  const mal = stream.mal;
  if (!mal || typeof mal !== "object" || mal.stream_verified !== true)
    return fail("unverified_stream", input.started);
  if (
    Number(mal.mal_id) !== input.malId ||
    Number(mal.mal_episode) !== input.episode
  )
    return fail("stream_mismatch", input.started);
  if (stream.stream_type !== "hls") return fail("not_hls", input.started);
  const master = typeof stream.master_url === "string" ? stream.master_url : "";
  if (!master || !isAllowedUpstreamUrl(master))
    return fail("master_host_not_allowed", input.started);
  const playable =
    Array.isArray(stream.variants) &&
    stream.variants.some((variant) => variant?.playable === true);
  if (!playable) return fail("no_playable_variant", input.started);
  return {
    ok: true,
    stream: stream as AniStreamResponse,
    cached: false,
    ms: now() - input.started,
  };
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now()) : null;
}

type Attempt =
  | { ok: true; body: unknown }
  | {
      ok: false;
      reason: AniReason;
      status: number;
      retryable: boolean;
      retryAfterMs: number | null;
    };

async function requestOnce(
  config: AniConfig,
  input: { malId: number; episode: number; audio: string; refresh?: boolean },
): Promise<Attempt> {
  const url = new URL(
    `${config.baseUrl}/v1/streams/mal/${input.malId}/episode/${input.episode}`,
  );
  url.searchParams.set("audio", input.audio);
  url.searchParams.set("quality", "best");
  if (input.refresh) url.searchParams.set("refresh", "true");

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        "x-api-key": config.apiKey || "",
        "user-agent": "KumoriTV",
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      ok: false,
      reason:
        name === "TimeoutError" || name === "AbortError"
          ? "timeout"
          : "network_error",
      status: 0,
      retryable: true,
      retryAfterMs: null,
    };
  }

  const body = await response.json().catch(() => undefined);

  if (response.ok) {
    if (!body || typeof body !== "object")
      return {
        ok: false,
        reason: "invalid_body",
        status: response.status,
        retryable: false,
        retryAfterMs: null,
      };
    return { ok: true, body };
  }

  const code = upstreamErrorCode(body);
  const mapped = reasonForErrorCode(code);
  const status = response.status;
  const retryable = status === 502 || status === 503 || status === 504;

  if (status === 401 || status === 403)
    return { ok: false, reason: mapped ?? "auth", status, retryable: false, retryAfterMs: null };
  if (status === 429)
    return {
      ok: false,
      reason: "rate_limited",
      status,
      retryable: false,
      retryAfterMs: retryAfterMs(response) ?? DEFAULT_RATE_LIMIT_PAUSE_MS,
    };
  // A mapped MAL_* code keeps its own meaning, but a 502/503/504 behind it is
  // still transient and still gets the single retry.
  if (mapped)
    return { ok: false, reason: mapped, status, retryable, retryAfterMs: null };
  if (status >= 500)
    return { ok: false, reason: "upstream_error", status, retryable, retryAfterMs: null };
  return { ok: false, reason: "http_error", status, retryable: false, retryAfterMs: null };
}

/** Reasons that mean the provider itself is unhealthy (they feed the breaker). */
function countsAsBreakerFailure(reason: AniReason) {
  return (
    reason === "network_error" ||
    reason === "timeout" ||
    reason === "upstream_error" ||
    reason === "invalid_body" ||
    reason === "auth"
  );
}

async function fetchUncached(
  config: AniConfig,
  input: {
    malId: number;
    episode: number;
    audio: string;
    refresh?: boolean;
    started: number;
  },
): Promise<AniStreamResult> {
  let attempt = await requestOnce(config, input);
  if (!attempt.ok && attempt.retryable) {
    // Exactly one retry, and only for a transient transport failure. A 4xx is
    // an answer, not a hiccup, so it is never retried.
    await sleep(250);
    attempt = await requestOnce(config, input);
  }

  if (attempt.ok) {
    const result = validateAniStream(attempt.body, {
      malId: input.malId,
      episode: input.episode,
      started: input.started,
    });
    if (result.ok) {
      recordBreakerSuccess();
      return result;
    }
    return result;
  }

  if (attempt.reason === "rate_limited")
    pausedUntil = now() + (attempt.retryAfterMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS);
  if (countsAsBreakerFailure(attempt.reason)) recordBreakerFailure();
  return { ok: false, reason: attempt.reason, ms: now() - input.started };
}

export async function getAniStream(input: {
  malId: number;
  episode: number;
  audio: "sub" | "dub";
  refresh?: boolean;
}): Promise<AniStreamResult> {
  const started = now();
  const config = aniConfig();
  if (!config.enabled) return fail("disabled", started);
  if (!config.baseUrl || !config.apiKey) return fail("not_configured", started);

  const key = cacheKey(input.malId, input.episode, input.audio);
  if (!input.refresh) {
    const cached = readCache(key);
    if (cached) return { ...cached, ms: now() - started, ...(cached.ok ? { cached: true } : {}) };
  }

  const running = inflight.get(key);
  if (running) return running;

  const at = now();
  if (breakerIsOpen(at)) return fail("breaker_open", started);
  if (pausedUntil > at) return fail("paused", started);
  if (active >= config.maxConcurrency) return fail("saturated", started);
  if (!takeToken(config, at)) return fail("saturated", started);

  const run = (async (): Promise<AniStreamResult> => {
    active++;
    try {
      const result = await fetchUncached(config, {
        malId: input.malId,
        episode: input.episode,
        audio: input.audio,
        refresh: input.refresh,
        started,
      });
      const ttl = result.ok ? POSITIVE_TTL_MS : negativeTtlMs(result.reason);
      if (ttl > 0) writeCache(key, result, ttl);
      return result;
    } catch (error) {
      // A bug in here must never take a watch request down with it.
      if (error instanceof AniProviderError)
        return { ok: false, reason: error.reason, ms: now() - started };
      return { ok: false, reason: "internal_error", ms: now() - started };
    } finally {
      active--;
      inflight.delete(key);
    }
  })();

  inflight.set(key, run);
  return run;
}

export function recordAniOutcome(record: Omit<AniOutcomeRecord, "at">) {
  const entry: AniOutcomeRecord = { ...record, at: new Date().toISOString() };
  outcomes.push(entry);
  while (outcomes.length > OUTCOME_LIMIT) outcomes.shift();
  const key = `${record.outcome}:${record.reason ?? "none"}`;
  counters.set(key, (counters.get(key) || 0) + 1);
}

/** Admin view. Deliberately contains no key, no URL and no upstream body. */
export function aniStats() {
  const config = aniConfig();
  const at = now();
  return {
    enabled: config.enabled,
    configured: Boolean(config.baseUrl && config.apiKey),
    host: config.baseUrl ? new URL(config.baseUrl).host : null,
    percent: config.percent,
    dubEnabled: config.dubEnabled,
    timeoutMs: config.timeoutMs,
    maxConcurrency: config.maxConcurrency,
    ratePerMin: config.ratePerMin,
    breaker: {
      open: breakerIsOpen(at),
      opensAt: openUntil > at ? new Date(openUntil).toISOString() : null,
      recentFailures: failureTimes.length,
      threshold: BREAKER_THRESHOLD,
      windowMs: BREAKER_WINDOW_MS,
      cooldownMs: BREAKER_COOLDOWN_MS,
    },
    paused: pausedUntil > at,
    pausedUntil: pausedUntil > at ? new Date(pausedUntil).toISOString() : null,
    cache: {
      entries: cache.size,
      limit: CACHE_LIMIT,
      positiveTtlMs: POSITIVE_TTL_MS,
      negativeTtlLongMs: NEGATIVE_TTL_LONG_MS,
      negativeTtlShortMs: NEGATIVE_TTL_SHORT_MS,
    },
    limiter: { tokens: Math.round(tokens * 10) / 10, active },
    counters: Object.fromEntries([...counters.entries()].sort()),
    outcomes: [...outcomes].reverse(),
  };
}

/** Test hook: module state is per process, so a test must be able to start clean. */
export function __resetAniStateForTests() {
  cache.clear();
  inflight.clear();
  failureTimes = [];
  openUntil = 0;
  pausedUntil = 0;
  tokens = 0;
  lastRefill = 0;
  active = 0;
  outcomes.length = 0;
  counters.clear();
}
