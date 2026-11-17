// Phase 4, part B2: what a valid announcement is, decided in ONE place.
//
// The API validates with this module and the composer runs the same rules before
// it enables Publish, so the browser's messages and the server's refusals can
// never disagree. Nothing here touches Supabase or React.

import { plainSnippet } from "./latest";

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 5_000;
/** The bell, the OG description and the push body are all short. */
export const ANNOUNCEMENT_EXCERPT_MAX = 180;
export const ANNOUNCEMENT_PUSH_MAX = 140;

/** The only fields a caller may send. Anything else is rejected, not ignored. */
export const ANNOUNCEMENT_FIELDS = [
  "title",
  "body",
  "image",
  "url",
  "expiresAt",
  "sendPush",
  "idempotencyKey",
] as const;

export type AnnouncementInput = {
  title: string;
  body: string;
  image: string | null;
  url: string | null;
  /** ISO instant, or null for "never expires". */
  expiresAt: string | null;
  /** When false the row is stamped `push_sent_at` so the cron skips it. */
  sendPush: boolean;
  idempotencyKey: string | null;
};

export type ValidationFailure = {
  ok: false;
  field: string;
  message: string;
};

export type ValidationSuccess = { ok: true; value: AnnouncementInput };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** https only for the two URL fields: no http page mixed into an https site. */
export function safeHttpsUrl(value: unknown): string | null | false {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") return false;
    // A bare "https://" is not a URL a browser can open.
    if (!parsed.hostname) return false;
    return parsed.toString();
  } catch {
    return false;
  }
}

export function validateAnnouncementInput(
  raw: unknown,
  now: number = Date.now(),
): ValidationSuccess | ValidationFailure {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, field: "body", message: "Send a JSON object." };
  }

  const record = raw as Record<string, unknown>;
  const unknown = Object.keys(record).filter(
    (key) => !(ANNOUNCEMENT_FIELDS as readonly string[]).includes(key),
  );
  if (unknown.length) {
    return { ok: false, field: unknown[0], message: `Unknown field: ${unknown[0]}.` };
  }

  const title = String(record.title ?? "").trim();
  if (!title) return { ok: false, field: "title", message: "A title is required." };
  if (title.length > ANNOUNCEMENT_TITLE_MAX) {
    return { ok: false, field: "title", message: `The title is longer than ${ANNOUNCEMENT_TITLE_MAX} characters.` };
  }

  const body = String(record.body ?? "").trim();
  if (!body) return { ok: false, field: "body", message: "The body is required." };
  if (body.length > ANNOUNCEMENT_BODY_MAX) {
    return { ok: false, field: "body", message: `The body is longer than ${ANNOUNCEMENT_BODY_MAX} characters.` };
  }

  const image = safeHttpsUrl(record.image);
  if (image === false) {
    return { ok: false, field: "image", message: "The image URL must start with https://." };
  }
  const url = safeHttpsUrl(record.url);
  if (url === false) {
    return { ok: false, field: "url", message: "The link must start with https://." };
  }

  let expiresAt: string | null = null;
  if (record.expiresAt !== null && record.expiresAt !== undefined && record.expiresAt !== "") {
    const raw = String(record.expiresAt);
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) {
      return { ok: false, field: "expiresAt", message: "The expiry is not a valid date." };
    }
    if (parsed <= now) {
      return { ok: false, field: "expiresAt", message: "The expiry must be in the future." };
    }
    expiresAt = new Date(parsed).toISOString();
  }

  const sendPush = record.sendPush === undefined ? true : record.sendPush;
  if (typeof sendPush !== "boolean") {
    return { ok: false, field: "sendPush", message: "sendPush must be true or false." };
  }

  let idempotencyKey: string | null = null;
  if (record.idempotencyKey !== null && record.idempotencyKey !== undefined && record.idempotencyKey !== "") {
    const key = String(record.idempotencyKey).trim();
    if (!UUID.test(key)) {
      return { ok: false, field: "idempotencyKey", message: "The idempotency key must be a UUID." };
    }
    idempotencyKey = key;
  }

  return {
    ok: true,
    value: { title, body, image, url, expiresAt, sendPush, idempotencyKey },
  };
}

/** The plain-text projection: bell preview, meta description, push body. */
export function announcementPlainText(body: string | null | undefined, max = ANNOUNCEMENT_PUSH_MAX): string {
  return plainSnippet(body, max);
}

/** "Active" or "expired", decided the same way the read policy does. */
export function announcementStatus(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): "active" | "expired" {
  if (!expiresAt) return "active";
  return Date.parse(expiresAt) > now ? "active" : "expired";
}
