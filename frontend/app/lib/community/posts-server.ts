// Prompt 38B: the write side of the community, as plain functions.
//
// The route handlers are thin wrappers around these so the rules can be tested
// without a Next request: the session, the rate limiter and the database write
// are all injected.
//
// WHY POSTS ARE INSERTED WITH THE SERVICE ROLE
// public.community_posts has NO insert policy (see docs/sql/community.sql), so
// a direct PostgREST insert from a browser - signed in or not - is refused by
// RLS. The only way in is POST /api/community/posts, which derives author_id
// from the verified session (never from the body), validates length and
// profanity server-side, and then writes with the service role. That is the
// "remove the insert policy and write through the API" option from amendment 4;
// it makes the API the single choke point instead of one of two.
import { cleanPostBody, validateCreateReport, validateCreatePost } from "./body";
import { POST_CREATE_PER_MINUTE, REPORT_PER_HOUR } from "./rate-limit";
import type { RateLimiter } from "@/app/lib/clips/rate-limit";

export type CommunitySession = { userId: string | null; isAnonymous: boolean };
export type HandlerResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

export type PostRow = {
  id: string;
  author_id: string;
  body: string;
  is_spoiler: boolean;
  created_at: string;
};

export type InsertPost = (row: {
  author_id: string;
  body: string;
  is_spoiler: boolean;
}) => Promise<{ data: PostRow | null; error: { message?: string } | null }>;

/** Maps a database guard message onto an HTTP answer. The guard is the truth. */
export function classifyPostWriteError(message: string): HandlerResult {
  if (/posting too fast/i.test(message)) {
    return { status: 429, body: { error: "rate_limited", message: "You're posting too quickly. Wait a moment." } };
  }
  if (/posting limit for this hour/i.test(message)) {
    return {
      status: 429,
      body: { error: "rate_limited", message: "You've reached the hourly posting limit. Try again later." },
    };
  }
  if (/just posted that/i.test(message)) {
    return { status: 409, body: { error: "duplicate_post", message: "You just posted that." } };
  }
  if (/community_posts_body_len/i.test(message) || /body/i.test(message) && /too long/i.test(message)) {
    return { status: 400, body: { error: "body_too_long", message: "That post is too long." } };
  }
  return { status: 500, body: { error: "insert_failed", message: "We could not post that. Please try again." } };
}

export async function handleCreatePost(deps: {
  session: CommunitySession | null;
  raw: unknown;
  ip: string;
  limiter: RateLimiter;
  insert: InsertPost;
}): Promise<HandlerResult> {
  const { session } = deps;

  if (!session?.userId) {
    return { status: 401, body: { error: "unauthorized", message: "Sign in to post." } };
  }
  if (session.isAnonymous) {
    // A "continue as guest" Supabase session is a real auth.users row, but it
    // is not an account: it cannot post. RLS says the same thing for comments.
    return { status: 403, body: { error: "sign_in_required", message: "Sign in to post." } };
  }

  const decision = deps.limiter.check(`${deps.ip}:${session.userId}`, POST_CREATE_PER_MINUTE);
  if (!decision.allowed) {
    return {
      status: 429,
      headers: { "retry-after": String(decision.retryAfterSeconds) },
      body: { error: "rate_limited", message: "You're posting too quickly. Wait a moment." },
    };
  }

  const parsed = validateCreatePost(deps.raw);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error, message: parsed.message } };
  }

  const { data, error } = await deps.insert({
    author_id: session.userId,
    body: parsed.value.body,
    is_spoiler: parsed.value.isSpoiler,
  });

  if (error) return classifyPostWriteError(error.message ?? "");
  if (!data) return { status: 500, body: { error: "insert_failed", message: "We could not post that." } };

  return { status: 201, body: { post: data } };
}

export type InsertReport = (row: {
  reporter_id: string | null;
  reporter_hash: string | null;
  target_kind: string;
  target_id: string;
  reason: string;
  details: string | null;
}) => Promise<{ error: { message?: string; code?: string } | null }>;

export async function handleCreateReport(deps: {
  session: CommunitySession | null;
  raw: unknown;
  reporterHash: string;
  limiter: RateLimiter;
  insert: InsertReport;
}): Promise<HandlerResult> {
  const parsed = validateCreateReport(deps.raw);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error, message: parsed.message } };

  const key = deps.session?.userId ?? deps.reporterHash;
  const decision = deps.limiter.check(key, REPORT_PER_HOUR);
  if (!decision.allowed) {
    return {
      status: 429,
      headers: { "retry-after": String(decision.retryAfterSeconds) },
      body: { error: "rate_limited", message: "You've sent a few reports already. Try again later." },
    };
  }

  const { error } = await deps.insert({
    reporter_id: deps.session?.userId ?? null,
    reporter_hash: deps.session?.userId ? null : deps.reporterHash,
    target_kind: parsed.value.targetKind,
    target_id: parsed.value.targetId,
    reason: parsed.value.reason,
    details: parsed.value.details,
  });

  if (error) {
    // 23505 = the unique index on (target_kind, target_id, reporter_id).
    if (error.code === "23505") {
      return { status: 409, body: { error: "already_reported", message: "You've already reported that." } };
    }
    return { status: 500, body: { error: "report_failed", message: "We could not send that report." } };
  }

  return { status: 200, body: { ok: true } };
}

/** Profanity is cleaned here as well as in the validator, so callers that build
 *  a post from somewhere else cannot skip it. */
export function normalisePostBody(body: string): string {
  return cleanPostBody(body.trim()).trim();
}
