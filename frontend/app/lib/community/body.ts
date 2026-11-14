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
  POST_LINK_MAX,
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
} from "./constants";
import { extractClipUrl, parseClipInput } from "./clip-url";

// Re-exported so the server modules keep one import path; the browser takes
// these from ./constants directly (no bad-words in the client bundle).
export { COMMUNITY_COMMENT_MAX, POST_BODY_MAX, POST_BODY_MIN, POST_LINK_MAX, REPORT_DETAILS_MAX, REPORT_REASONS };
export type { ReportReason };

export const REPORT_TARGETS = ["post", "comment", "announcement"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string; message: string };

export type CreatePostInput = {
  /** Cleaned user text. Empty ONLY when a clip is attached (clip-only post). */
  body: string;
  isSpoiler: boolean;
  /** A code, not a URL. The caller still has to resolve it before writing. */
  clipCode: string | null;
  /** A plain link, kept as text. A clip URL never lands here. */
  linkUrl: string | null;
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
 * Phase 3 accepts text, the spoiler toggle, a clip attachment and a plain link.
 * Unknown keys are ignored (never trusted).
 *
 * THE ATTACHMENT RULE
 *   One attachment per post. `clip_code` and a plain `link_url` are mutually
 *   exclusive, because the table says so
 *   (community_posts_attachment_chk: clip_id is null or link_url is null).
 *   A clip URL inside `link_url` is not a plain link: it is turned into
 *   clipCode and `link_url` is dropped, which is how "paste a clip URL into the
 *   box" works without the composer having to classify every paste. Any other
 *   URL stays a plain link.
 *
 * A POST MAY BE CLIP-ONLY
 *   With a clip attached, empty text is allowed here; handleCreatePost fills in
 *   the default body (the clip's own title, else "Shared a clip") because the
 *   table requires 1..1000 characters and a bare attachment is a complete post.
 */
export function validateCreatePost(raw: unknown): Validation<CreatePostInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("invalid_body", "That request was not understood.");
  }
  const input = raw as Record<string, unknown>;

  if (input.body !== undefined && typeof input.body !== "string") {
    return fail("invalid_body", "Write something first.");
  }
  const rawBody = typeof input.body === "string" ? input.body : "";
  const trimmed = rawBody.trim();

  if (input.isSpoiler !== undefined && typeof input.isSpoiler !== "boolean") {
    return fail("invalid_spoiler", "The spoiler flag was not understood.");
  }
  const isSpoiler = input.isSpoiler === true;

  // ---------------------------------------------------------------- clip ----
  let clipCode: string | null = null;
  if (input.clip_code !== undefined && input.clip_code !== null && input.clip_code !== "") {
    // The composer sends a code; a pasted link is accepted here too so the two
    // inputs cannot disagree about what a clip is.
    const parsedCode = parseClipInput(input.clip_code);
    if (parsedCode.kind !== "clip") {
      return fail("invalid_clip", "That is not a clip code.");
    }
    clipCode = parsedCode.code;
  }

  // ---------------------------------------------------------------- link ----
  let linkUrl: string | null = null;
  if (input.link_url !== undefined && input.link_url !== null && input.link_url !== "") {
    if (typeof input.link_url !== "string") {
      return fail("invalid_link", "That link was not understood.");
    }
    const candidate = input.link_url.trim();
    if (candidate.length > POST_LINK_MAX) {
      return fail("invalid_link", `Links can be up to ${POST_LINK_MAX} characters.`);
    }
    // Only a real http(s) URL may be stored. javascript:, data: and a bare word
    // are refused rather than cleaned, because a post that promises a link and
    // stores nothing is worse than one that says no.
    if (!/^https?:\/\/[^\s]+$/i.test(candidate)) {
      return fail("invalid_link", "Links must start with http:// or https://.");
    }
    const asClip = extractClipUrl(candidate);
    if (asClip) {
      if (clipCode && clipCode !== asClip.code) {
        return fail("clip_and_link", "One attachment per post.");
      }
      clipCode = asClip.code;
    } else {
      linkUrl = candidate;
    }
  }

  if (clipCode && linkUrl) {
    return fail("clip_and_link", "One attachment per post.");
  }

  // ---------------------------------------------------------------- body ----
  if (trimmed.length > POST_BODY_MAX) {
    return fail("body_too_long", `Posts can be up to ${POST_BODY_MAX} characters.`);
  }
  const isBlank = trimmed.replace(/\s/g, "").length === 0;
  if (isBlank && !clipCode) {
    return fail("empty_body", "Write something first.");
  }
  if (trimmed.length < POST_BODY_MIN && !clipCode) {
    return fail("empty_body", "Write something first.");
  }

  // Profanity is replaced, not rejected: the same behaviour the comment box has
  // had since Prompt 15, so a post never fails because of one word.
  const body = isBlank ? "" : cleanPostBody(trimmed).trim();

  return { ok: true, value: { body, isSpoiler, clipCode, linkUrl } };
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
