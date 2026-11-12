// Prompt 35: request-body validation for every clips route.
//
// The routes never trust the client for anything: the id comes from the session,
// the length ceiling comes from whether the session exists, and every field is
// re-checked here before it reaches the database.

import { validateClipRange } from "./range";
import { MAX_TIME_SECONDS } from "./time";
import { normaliseClipTitle } from "./title";

export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; message: string };

const fail = (error: string, message: string) => ({ ok: false, error, message }) as const;

const asObject = (body: unknown): Record<string, unknown> | null =>
  body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;

export type CreateClipBody = {
  anilistId: number;
  episode: number;
  start: number;
  end: number;
  title: string | null;
  audio: "sub" | "dub" | null;
};

/** `POST /api/clips`. `maxSeconds` is 60 for guests and 120 for a session. */
export function validateCreateClipBody(
  body: unknown,
  maxSeconds: number,
): Validation<CreateClipBody> {
  const input = asObject(body);
  if (!input) return fail("invalid_body", "Send a JSON object.");

  // Strict numbers: a numeric string is not a valid id, it is a client bug.
  const anilistId = input.anilistId;
  if (
    typeof anilistId !== "number" ||
    !Number.isInteger(anilistId) ||
    anilistId <= 0 ||
    anilistId > 2147483647
  ) {
    return fail("invalid_anilist_id", "That anime id is not valid.");
  }

  const episode = input.episode;
  if (typeof episode !== "number" || !Number.isInteger(episode) || episode <= 0 || episode > 99999) {
    return fail("invalid_episode", "That episode number is not valid.");
  }

  if (typeof input.start !== "number" || typeof input.end !== "number") {
    return fail("invalid_time", "Enter a start and end time.");
  }
  // Nothing on an episode is longer than a day; beyond that it is a typo, and
  // the numeric(8,2) column would refuse it anyway.
  if (input.start > MAX_TIME_SECONDS || input.end > MAX_TIME_SECONDS) {
    return fail("invalid_time", "That time is past the end of any episode.");
  }

  // Duration is unknown on the server; the panel checks it against the player.
  const range = validateClipRange({ start: input.start, end: input.end, maxSeconds });
  if (!range.ok) return fail(range.error, range.message);

  const title = normaliseClipTitle(input.title);
  if (!title.ok) return fail(title.error, title.message);

  let audio: "sub" | "dub" | null = null;
  if (input.audio !== undefined && input.audio !== null) {
    if (input.audio !== "sub" && input.audio !== "dub") {
      return fail("invalid_audio", "Audio must be sub or dub.");
    }
    audio = input.audio;
  }

  return {
    ok: true,
    value: { anilistId, episode, start: range.start, end: range.end, title: title.title, audio },
  };
}

/** The reasons the clip page offers; free text lives in `details`. */
export const CLIP_REPORT_REASONS = [
  "copyright",
  "broken",
  "inappropriate",
  "spam",
  "other",
] as const;

export type ClipReportReason = (typeof CLIP_REPORT_REASONS)[number];

export const CLIP_REPORT_DETAILS_MAX = 500;

export type ClipReportBody = { reason: ClipReportReason; details: string | null };

/** `POST /api/clips/[code]/report`. */
export function validateClipReportBody(body: unknown): Validation<ClipReportBody> {
  const input = asObject(body);
  if (!input) return fail("invalid_report", "Pick a reason for the report.");

  const reason = typeof input.reason === "string" ? input.reason.trim().toLowerCase() : "";
  if (!(CLIP_REPORT_REASONS as readonly string[]).includes(reason)) {
    return fail("invalid_report", "Pick a reason for the report.");
  }

  let details: string | null = null;
  if (input.details !== undefined && input.details !== null) {
    if (typeof input.details !== "string") {
      return fail("invalid_report", "That report text is not valid.");
    }
    const cleaned = input.details
      .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length > CLIP_REPORT_DETAILS_MAX) {
      return fail("report_too_long", `Keep the note under ${CLIP_REPORT_DETAILS_MAX} characters.`);
    }
    details = cleaned || null;
  }

  return { ok: true, value: { reason: reason as ClipReportReason, details } };
}

/** A rename is the same title rules as creation. */
export function validateRenameClipBody(body: unknown): Validation<{ title: string | null }> {
  const input = asObject(body);
  if (!input) return fail("invalid_body", "Send a JSON object.");
  if (!("title" in input)) return fail("title_invalid", "That title is not valid text.");
  const title = normaliseClipTitle(input.title);
  if (!title.ok) return fail(title.error, title.message);
  return { ok: true, value: { title: title.title } };
}
