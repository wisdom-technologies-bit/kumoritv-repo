// Prompt 35: guest clip ownership.
//
// A guest has no account, but must still be able to delete the clips they made
// for 30 days. The browser holds a random token in a first-party HttpOnly
// cookie; the table only ever stores its hash, so a database leak does not hand
// anyone the ability to delete clips. The raw token is never logged or returned.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 bytes -> 43 base64url characters: unguessable, cookie-safe. */
export const OWNER_TOKEN_BYTES = 32;

export function createOwnerToken(): string {
  return randomBytes(OWNER_TOKEN_BYTES).toString("base64url");
}

/**
 * Hash of a token. An optional server secret (`CLIP_OWNER_SECRET`) turns this
 * into an HMAC; without it the token's own entropy still makes the digest
 * useless as a credential.
 */
export function hashOwnerToken(token: unknown, secret?: string | null): string | null {
  if (typeof token !== "string") return null;
  const value = token.trim();
  // base64url of 32 bytes is 43 chars; allow a little slack for future sizes.
  if (value.length < 16 || value.length > 128) return null;
  const key = typeof secret === "string" ? secret.trim() : "";
  return key
    ? createHmac("sha256", key).update(value).digest("hex")
    : createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison, so a wrong token cannot be timed out. */
export function ownerTokenMatches(
  token: unknown,
  expectedHash: unknown,
  secret?: string | null,
): boolean {
  if (typeof expectedHash !== "string" || expectedHash.length === 0) return false;
  const actual = hashOwnerToken(token, secret);
  if (!actual || actual.length !== expectedHash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expectedHash, "hex"));
  } catch {
    return false;
  }
}

/** The env secret, if the deployment sets one. Never logged. */
export function ownerTokenSecret(): string | null {
  const value = process.env.CLIP_OWNER_SECRET;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Salted hash for a coarse identifier such as an IP. Used for `clip_reports`:
 * enough to spot repeat abuse, no personal data written to the table.
 */
export function hashIdentifier(value: unknown, secret?: string | null): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().slice(0, 200);
  if (!clean) return null;
  const key = typeof secret === "string" ? secret.trim() : "";
  return key
    ? createHmac("sha256", key).update(clean).digest("hex")
    : createHash("sha256").update(clean).digest("hex");
}
