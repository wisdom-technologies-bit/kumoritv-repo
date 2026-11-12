// Prompt 35: in-memory sliding-window rate limits.
//
// Same shape as the watch-report limiter, but the decision is a pure function so
// it can be tested without a request: guests get 10 clips an hour per IP+cookie
// and signed-in users 60 (see constants.ts).

import { CLIP_RATE_WINDOW_MS } from "./constants";

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the oldest hit leaves the window (0 when allowed). */
  retryAfterSeconds: number;
};

export type RateLimiter = {
  check: (key: string, limit: number, now?: number) => RateLimitDecision;
  reset: () => void;
  size: () => number;
};

export type RateLimiterOptions = {
  windowMs?: number;
  /** Hard cap on tracked keys, so a flood of IPs cannot grow the map forever. */
  maxKeys?: number;
};

export function createRateLimiter({
  windowMs = CLIP_RATE_WINDOW_MS,
  maxKeys = 5000,
}: RateLimiterOptions = {}): RateLimiter {
  const hits = new Map<string, number[]>();

  const prune = (key: string, now: number) => {
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length) hits.set(key, recent);
    else hits.delete(key);
    return recent;
  };

  return {
    check(key, limit, now = Date.now()) {
      const recent = prune(key, now);
      if (recent.length >= limit) {
        const oldest = recent[0] ?? now;
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
        };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        // Map keeps insertion order: the first key is the least recently used.
        const oldestKey = hits.keys().next().value;
        if (typeof oldestKey === "string") hits.delete(oldestKey);
      }
      return { allowed: true, remaining: Math.max(0, limit - recent.length), retryAfterSeconds: 0 };
    },
    reset() {
      hits.clear();
    },
    size() {
      return hits.size;
    },
  };
}

/** The shared limiter for clip creation. */
export const clipCreationLimiter = createRateLimiter();
/** Reporting is cheaper, so it has its own budget. */
export const clipReportLimiter = createRateLimiter();

/** One key per identity: a signed-in id, or the guest's IP + owner token. */
export function rateLimitKey({
  userId,
  ip,
  ownerHash,
}: {
  userId?: string | null;
  ip?: string | null;
  ownerHash?: string | null;
}): string {
  if (userId) return `user:${userId}`;
  return `guest:${(ip || "unknown").trim()}:${(ownerHash || "none").slice(0, 16)}`;
}
