// Prompt 38B: server-side validation for community writes.
//
// The browser form is a courtesy; this is the gate. No zod in this repo, so
// the shape is the same hand-written validator used by app/lib/clips/body.ts:
// an explicit field list, explicit caps, a discriminated result.
import Filter from "bad-words";
import type { ReportReason } from "./constants";
import {
  COMMUNITY_COMMENT_MAX,
  POST_BODY_MAX,
  POST_BODY_MIN,
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
} from "./constants";

// Re-exported so the server modules keep one import path; the browser takes
// these from ./constants directly (no bad-words in the client bundle).
export { COMMUNITY_COMMENT_MAX, POST_BODY_MAX, POST_BODY_MIN, REPORT_DETAILS_MAX, REPORT_REASONS };
export type { ReportReason };

export const REPORT_TARGETS = ["post", "comment", "announcement"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string; message: string };

export type CreatePostInput = {
  body: string;
  isSpoiler: boolean;
};

export type CreateReportInput = {
  targetKind: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let filter: Filter | null = null;
function profanityFilter(): Filter {
  filter ??= new Filter();
  return filter;
}

/** Replaces profanity with asterisks. Exported so the test can assert it ran. */
export function cleanPostBody(body: string): string {
  return profanityFilter().clean(body);
}

export function isProfane(body: string): boolean {
  return profanityFilter().isProfane(body);
}

function fail(error: string, message: string): { ok: false; error: string; message: string } {
  return { ok: false, error, message };
}

/**
 * POST /api/community/posts body.
 *
 * Phase 1 accepts text and the spoiler toggle only. Unknown keys are ignored
 * (never trusted); clip attachments and links are later phases.
 */
export function validateCreatePost(raw: unknown): Validation<CreatePostInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("invalid_body", "That request was not understood.");
  }
  const input = raw as Record<string, unknown>;

  if (typeof input.body !== "string") {
    return fail("invalid_body", "Write something first.");
  }

  const trimmed = input.body.trim();
  if (trimmed.length < POST_BODY_MIN) {
    return fail("empty_body", "Write something first.");
  }
  if (trimmed.length > POST_BODY_MAX) {
    return fail("body_too_long", `Posts can be up to ${POST_BODY_MAX} characters.`);
  }
  if (trimmed.replace(/\s/g, "").length === 0) {
    return fail("empty_body", "Write something first.");
  }

  if (input.isSpoiler !== undefined && typeof input.isSpoiler !== "boolean") {
    return fail("invalid_spoiler", "The spoiler flag was not understood.");
  }

  const isSpoiler = input.isSpoiler === true;
  // Profanity is replaced, not rejected: the same behaviour the comment box has
  // had since Prompt 15, so a post never fails because of one word.
  const body = cleanPostBody(trimmed).trim();

  return { ok: true, value: { body, isSpoiler } };
}

/** POST /api/community/report body. */
export function validateCreateReport(raw: unknown): Validation<CreateReportInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("invalid_body", "That request was not understood.");
  }
  const input = raw as Record<string, unknown>;

  const targetKind = typeof input.target_kind === "string" ? input.target_kind : "";
  if (!(REPORT_TARGETS as readonly string[]).includes(targetKind)) {
    return fail("invalid_target", "That is not something you can report.");
  }

  const targetId = typeof input.target_id === "string" ? input.target_id.trim() : "";
  if (!UUID.test(targetId)) {
    return fail("invalid_target", "That is not something you can report.");
  }

  const reason = typeof input.reason === "string" ? input.reason : "";
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
    return fail("invalid_reason", "Pick a reason for the report.");
  }

  let details: string | null = null;
  if (input.details !== undefined && input.details !== null) {
    if (typeof input.details !== "string") {
      return fail("invalid_details", "The details were not understood.");
    }
    const trimmedDetails = input.details.trim();
    if (trimmedDetails.length > REPORT_DETAILS_MAX) {
      return fail("details_too_long", `Keep the details under ${REPORT_DETAILS_MAX} characters.`);
    }
    details = trimmedDetails || null;
  }

  return {
    ok: true,
    value: {
      targetKind: targetKind as ReportTarget,
      targetId,
      reason: reason as ReportReason,
      details,
    },
  };
}
