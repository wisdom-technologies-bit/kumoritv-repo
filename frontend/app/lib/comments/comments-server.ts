// Phase 6, part E: the server side of comment writes.
//
// Before this file, a comment was inserted straight from the browser with the
// viewer's session and RLS said yes or no. RLS can check ownership and the
// target's visibility; it cannot run a profanity filter, and its error messages
// are Postgres prose. So the write moved here: one gate that validates, filters,
// rate limits, and only then writes - with the service role, because after the
// lockdown file the browser has no INSERT grant at all.
//
// The service role means ownership is NOT implicit any more, so every update and
// delete carries `user_id = <session user>` in the WHERE clause. A staff member's
// extra powers stay in SQL (community_moderate), not here.
import { COMMUNITY_COMMENT_MAX } from "@/app/lib/community/constants";
import { isProfane } from "@/app/lib/community/body";
import type { HandlerResult } from "@/app/lib/community/posts-server";

export type CommentSession = { userId: string | null; isAnonymous: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CommentTarget =
  | { kind: "anime"; anilistId: number; episodeNumber: number | null }
  | { kind: "post" | "announcement"; id: string };

export type ValidComment = {
  target: CommentTarget;
  body: string;
  isSpoiler: boolean;
  parentId: string | null;
};

export type CommentValidation =
  | { ok: true; value: ValidComment }
  | { ok: false; error: string; message: string };

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function intOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 && n < 100_000 ? n : null;
}

export function validateCreateComment(raw: unknown): CommentValidation {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const body = str(input.body).replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, error: "empty_body", message: "Write something first." };
  if (body.length > COMMUNITY_COMMENT_MAX) {
    return { ok: false, error: "body_too_long", message: `Keep it under ${COMMUNITY_COMMENT_MAX} characters.` };
  }
  if (isProfane(body)) {
    // The body is never echoed back and never logged: a rejection message that
    // repeats what was typed is a filter that teaches the workaround.
    return {
      ok: false,
      error: "profane",
      message: "That has language we don't allow here. Please reword it.",
    };
  }

  const parentId = typeof input.parentId === "string" && UUID.test(input.parentId) ? input.parentId : null;
  const isSpoiler = input.isSpoiler === true;

  const kind = str(input.targetKind);
  if (kind === "post" || kind === "announcement") {
    const id = str(input.targetId);
    if (!UUID.test(id)) return { ok: false, error: "invalid_target", message: "That comment target is missing." };
    return { ok: true, value: { target: { kind, id }, body, isSpoiler, parentId } };
  }

  const anilistId = intOrNull(input.anilistId);
  if (anilistId === null) {
    return { ok: false, error: "invalid_target", message: "That comment target is missing." };
  }
  return {
    ok: true,
    value: {
      target: { kind: "anime", anilistId, episodeNumber: intOrNull(input.episodeNumber) },
      body,
      isSpoiler,
      parentId,
    },
  };
}

export type CommentRowShape = {
  id: string;
  target_type?: "anime" | "post" | "announcement";
  post_id?: string | null;
  announcement_id?: string | null;
  anilist_id: number | null;
  episode_number: number | null;
  parent_id: string | null;
  user_id: string;
  body: string;
  is_spoiler: boolean;
  created_at: string;
};

export type InsertComment = (row: {
  target_type: "anime" | "post" | "announcement";
  anilist_id: number | null;
  episode_number: number | null;
  post_id: string | null;
  announcement_id: string | null;
  user_id: string;
  parent_id: string | null;
  body: string;
  is_spoiler: boolean;
}) => Promise<{ data: CommentRowShape | null; error: { message?: string } | null }>;

/** Postgres prose and the durable codes, in one place, as friendly sentences. */
export function classifyCommentWriteError(message: string): HandlerResult {
  if (/rate_limit:comments_minute/.test(message)) {
    return { status: 429, body: { error: "rate_limited", message: "You're commenting quickly. Give it a minute." } };
  }
  if (/rate_limit:comments_hour/.test(message)) {
    return {
      status: 429,
      body: { error: "rate_limited", message: "You've reached the hourly comment limit. Try again later." },
    };
  }
  if (/commenting too fast/i.test(message)) {
    return { status: 429, body: { error: "rate_limited", message: "You're commenting too fast. Wait a few seconds." } };
  }
  if (/invalid reply target/i.test(message)) {
    return { status: 400, body: { error: "invalid_parent", message: "That comment is gone, so the reply cannot land." } };
  }
  if (/row-level security|permission denied/i.test(message)) {
    return { status: 403, body: { error: "not_allowed", message: "You can't do that here." } };
  }
  return { status: 500, body: { error: "insert_failed", message: "We could not save that comment. Please try again." } };
}

export async function handleCreateComment(deps: {
  session: CommentSession | null;
  raw: unknown;
  ip: string;
  limiter: { check: (key: string, limit: number) => { allowed: boolean; retryAfterSeconds: number } };
  limit: number;
  insert: InsertComment;
}): Promise<HandlerResult> {
  const { session } = deps;
  if (!session?.userId) {
    return { status: 401, body: { error: "unauthorized", message: "Sign in to comment." } };
  }
  if (session.isAnonymous) {
    return { status: 403, body: { error: "sign_in_required", message: "Sign in to comment." } };
  }

  const decision = deps.limiter.check(`${deps.ip}:${session.userId}`, deps.limit);
  if (!decision.allowed) {
    return {
      status: 429,
      headers: { "retry-after": String(decision.retryAfterSeconds) },
      body: { error: "rate_limited", message: "You're commenting quickly. Wait a moment." },
    };
  }

  const parsed = validateCreateComment(deps.raw);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error, message: parsed.message } };

  const { target, body, isSpoiler, parentId } = parsed.value;
  const row = {
    target_type: target.kind,
    anilist_id: target.kind === "anime" ? target.anilistId : null,
    episode_number: target.kind === "anime" ? target.episodeNumber : null,
    post_id: target.kind === "post" ? target.id : null,
    announcement_id: target.kind === "announcement" ? target.id : null,
    user_id: session.userId,
    parent_id: parentId,
    body,
    is_spoiler: isSpoiler,
  };

  const { data, error } = await deps.insert(row);
  if (error) return classifyCommentWriteError(error.message ?? "");
  if (!data) {
    return { status: 500, body: { error: "insert_failed", message: "We could not save that comment." } };
  }

  return { status: 201, body: { comment: data } };
}

/** PATCH: spoiler flag only. The guard freezes every other column. */
export async function handleUpdateComment(deps: {
  session: CommentSession | null;
  commentId: string;
  raw: unknown;
  update: (args: { commentId: string; userId: string; isSpoiler: boolean }) => Promise<{
    data: { id: string; is_spoiler: boolean } | null;
    error: { message?: string } | null;
  }>;
}): Promise<HandlerResult> {
  if (!deps.session?.userId) {
    return { status: 401, body: { error: "unauthorized", message: "Sign in to comment." } };
  }
  if (!UUID.test(deps.commentId)) return { status: 404, body: { error: "not_found" } };

  const input = (deps.raw && typeof deps.raw === "object" ? deps.raw : {}) as Record<string, unknown>;
  if (typeof input.isSpoiler !== "boolean") {
    return { status: 400, body: { error: "invalid_patch", message: "Nothing to change." } };
  }

  const { data, error } = await deps.update({
    commentId: deps.commentId,
    userId: deps.session.userId,
    isSpoiler: input.isSpoiler,
  });
  if (error) return classifyCommentWriteError(error.message ?? "");
  if (!data) {
    // Not yours, or not there. The same answer either way: a 403 for someone
    // else's comment would confirm the comment exists.
    return { status: 404, body: { error: "not_found", message: "That comment is not yours to change." } };
  }
  return { status: 200, body: { comment: data } };
}

/** DELETE: soft delete, own comments only, same answer when it is not yours. */
export async function handleDeleteComment(deps: {
  session: CommentSession | null;
  commentId: string;
  remove: (args: { commentId: string; userId: string; at: string }) => Promise<{
    data: { id: string } | null;
    error: { message?: string } | null;
  }>;
  now?: () => Date;
}): Promise<HandlerResult> {
  if (!deps.session?.userId) {
    return { status: 401, body: { error: "unauthorized", message: "Sign in to comment." } };
  }
  if (!UUID.test(deps.commentId)) return { status: 404, body: { error: "not_found" } };

  const at = (deps.now ? deps.now() : new Date()).toISOString();
  const { data, error } = await deps.remove({ commentId: deps.commentId, userId: deps.session.userId, at });
  if (error) return classifyCommentWriteError(error.message ?? "");
  if (!data) return { status: 404, body: { error: "not_found", message: "That comment is not yours to delete." } };
  return { status: 200, body: { ok: true } };
}
