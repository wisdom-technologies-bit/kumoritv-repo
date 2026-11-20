// Signed `state` for the authorization-code grant: the CSRF guard AniList's
// implicit grant cannot offer.
//
// The state carries a nonce and an issue time, is signed with HMAC-SHA256 using a
// key derived from ANILIST_TOKEN_ENCRYPTION_KEY (separate label, so the cookie key
// and the state key are not the same bytes), and must match the httpOnly
// `anilist_state` cookie set by /auth/anilist/start. That pair is what makes a
// replayed callback URL useless in another browser.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const STATE_COOKIE_NAME = "anilist_state";
export const STATE_TTL_MS = 10 * 60 * 1000;

export function deriveStateKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", encryptionKey, Buffer.alloc(0), "anilist-state", 32));
}

export function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

function sign(key: Buffer, nonce: string, issuedAt: number): string {
  return createHmac("sha256", key).update(`${nonce}.${issuedAt}`).digest("base64url");
}

export function createState(key: Buffer, now = Date.now()): { state: string; nonce: string } {
  const nonce = newNonce();
  const issuedAt = now;

  return { state: `${nonce}.${issuedAt}.${sign(key, nonce, issuedAt)}`, nonce };
}

export type StateCheck = { ok: true; nonce: string } | { ok: false; reason: "malformed" | "signature" | "expired" | "cookie" };

/** Verifies the signature, the age and (when given) the cookie nonce. */
export function verifyState(
  state: string | null | undefined,
  key: Buffer,
  options: { now?: number; ttlMs?: number; cookieNonce?: string | null } = {}
): StateCheck {
  if (!state) return { ok: false, reason: "malformed" };

  const parts = state.split(".");

  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [nonce, issuedAtText, signature] = parts;
  const issuedAt = Number(issuedAtText);

  if (!nonce || !Number.isFinite(issuedAt)) return { ok: false, reason: "malformed" };

  const expected = sign(key, nonce, issuedAt);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);

  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return { ok: false, reason: "signature" };
  }

  const now = options.now ?? Date.now();

  if (now - issuedAt > (options.ttlMs ?? STATE_TTL_MS) || issuedAt - now > 60_000) {
    return { ok: false, reason: "expired" };
  }

  if (options.cookieNonce !== undefined && options.cookieNonce !== nonce) {
    return { ok: false, reason: "cookie" };
  }

  return { ok: true, nonce };
}
