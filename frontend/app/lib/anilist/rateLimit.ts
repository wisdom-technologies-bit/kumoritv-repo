// A small in-process limiter for the AniList routes.
//
// It is per instance, so it is a speed bump rather than a quota: the edge
// (Cloudflare) and the provider's own limits are the real ceiling. Documented in
// docs/anilist-login.md; see docs/security-audit.md for the cross-instance plan.

type Bucket = { count: number; expiresAt: number };

const buckets = new Map<string, Bucket>();

export function consume(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const current = buckets.get(key);

  if (!current || current.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + windowMs });

    return true;
  }

  if (current.count >= limit) return false;

  current.count += 1;

  return true;
}

/** Test hook: forget every bucket. */
export function resetRateLimits() {
  buckets.clear();
}

export function clientIp(headers: { get: (name: string) => string | null }): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
