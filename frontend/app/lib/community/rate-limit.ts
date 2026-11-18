// Prompt 38B: per-process speed bumps for the community write routes.
//
// NOT a security boundary: each serverless instance has its own Map, so the
// effective limit is `limit x instances` and a cold start forgets it. The
// limits that actually hold are in SQL (community_posts_guard: 1 post / 30 s,
// 20 / hour, duplicate body within 10 minutes; comments_guard: 1 / 10 s).
// These exist to keep a single warm instance from doing silly work.
import { createRateLimiter } from "@/app/lib/clips/rate-limit";

/** 5 posts a minute per IP, on top of the durable per-author SQL limits. */
export const postCreateLimiter = createRateLimiter({ windowMs: 60_000 });

/** 5 reports an hour per reporter key (session id or salted IP hash). */
export const reportLimiter = createRateLimiter({ windowMs: 60 * 60_000 });

export const POST_CREATE_PER_MINUTE = 5;
export const REPORT_PER_HOUR = 5;

/**
 * Phase 4: the public `latest` endpoint. 60 requests a minute per IP is two a
 * second - ten times the toast's own 30 s cadence, so a real reader never hits
 * it, while a scraper hammering the route is answered with a 429 and a
 * Retry-After instead of a database query.
 */
export const latestLimiter = createRateLimiter({ windowMs: 60_000 });
export const LATEST_PER_MINUTE = 60;

/**
 * Phase 4: announcement writes. Ten a minute per admin is generous for a human
 * and useless for a loop. Admin-only, so the key is the admin's own id.
 */
export const adminWriteLimiter = createRateLimiter({ windowMs: 60_000 });
export const ADMIN_WRITES_PER_MINUTE = 10;

/**
 * Phase 6: moderation writes. 60 a minute per staff member - far above any
 * human reviewing a queue, far below a loop. Keyed on the staff user id.
 */
export const moderationLimiter = createRateLimiter({ windowMs: 60_000 });
export const MODERATION_PER_MINUTE = 60;

/* ---------------------------------------------------------------------------
 * Phase 6, part D: per-rule hit counters.
 *
 * The durable limits live in SQL and cannot be counted from here. What CAN be
 * counted is how often the app refused a write, per rule, which is what the
 * moderation dashboard shows. These are per instance and reset on deploy - the
 * dashboard says so, because a number that silently means "this container"
 * is worse than no number.
 * ------------------------------------------------------------------------- */
const ruleHits = new Map<string, number>();

export type RuleHit = { rule: string; count: number };

export function recordRuleHit(rule: string): void {
  ruleHits.set(rule, (ruleHits.get(rule) ?? 0) + 1);
}

export function readRuleHits(): RuleHit[] {
  return [...ruleHits.entries()]
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count);
}

/** Tests only: counters are module state, and one test must not see another's. */
export function resetRuleHits(): void {
  ruleHits.clear();
}
