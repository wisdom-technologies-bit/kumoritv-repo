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
