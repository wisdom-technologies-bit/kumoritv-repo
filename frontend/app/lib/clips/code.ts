// Prompt 35: short clip codes.
//
// 7 characters from an alphabet with no 0/o/1/i/l, so a code can be read off a
// screen and typed by hand. Generated with rejection sampling (no modulo bias)
// and checked against the table before it is used.

import { CLIP_CODE_ALPHABET, CLIP_CODE_ATTEMPTS, CLIP_CODE_LENGTH } from "./constants";

const ALPHABET_SIZE = CLIP_CODE_ALPHABET.length;
/** Bytes at or above this are discarded so every character is equally likely. */
const REJECTION_LIMIT = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE;

export type ByteSource = (size: number) => Uint8Array;

const webCrypto = (): Crypto | null => {
  const candidate = (globalThis as { crypto?: Crypto }).crypto;
  return candidate && typeof candidate.getRandomValues === "function" ? candidate : null;
};

/** Cryptographically random bytes; tests inject their own source. */
export const randomBytes: ByteSource = (size: number) => {
  const out = new Uint8Array(size);
  const source = webCrypto();
  if (source) {
    source.getRandomValues(out);
    return out;
  }
  // No WebCrypto (very old runtime): still unpredictable enough for a code that
  // is checked for collisions before insert.
  for (let index = 0; index < size; index += 1) {
    out[index] = Math.floor(Math.random() * 256);
  }
  return out;
};

export function generateClipCode(bytesFor: ByteSource = randomBytes): string {
  let code = "";
  while (code.length < CLIP_CODE_LENGTH) {
    const bytes = bytesFor(CLIP_CODE_LENGTH * 2);
    for (let index = 0; index < bytes.length && code.length < CLIP_CODE_LENGTH; index += 1) {
      const byte = bytes[index];
      if (byte >= REJECTION_LIMIT) continue;
      code += CLIP_CODE_ALPHABET[byte % ALPHABET_SIZE];
    }
  }
  return code;
}

/** A code is valid only if it is exactly 7 characters from the alphabet. */
export function isClipCode(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length === CLIP_CODE_LENGTH &&
    /^[23456789abcdefghjkmnpqrstuvwxyz]+$/.test(value)
  );
}

/**
 * Generates a code the table does not already hold. `exists` is the collision
 * check (a `select code` by unique index); after `attempts` collisions the
 * caller gets null and answers 503 instead of guessing.
 */
export async function generateUniqueClipCode(
  exists: (code: string) => Promise<boolean>,
  bytesFor: ByteSource = randomBytes,
  attempts: number = CLIP_CODE_ATTEMPTS,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = generateClipCode(bytesFor);
    if (!(await exists(code))) return code;
  }
  return null;
}
