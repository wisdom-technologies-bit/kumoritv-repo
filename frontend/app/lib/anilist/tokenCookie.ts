// Reading and writing the AniList token cookie.
//
// Two formats live side by side:
//   - implicit flow (default): the JSON the login helper has always stored,
//     `{"accessToken":"...","tokenType":"Bearer","expiresIn":"31536000"}`;
//   - code flow (ANILIST_AUTH_FLOW=code): the same JSON, AES-256-GCM encrypted
//     with ANILIST_TOKEN_ENCRYPTION_KEY and prefixed `v1.`.
//
// The cookie is httpOnly either way. The encrypted form exists so that a stolen
// cookie backup or a log that captures the header does not hand over a one-year
// AniList token in clear text.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type AnilistToken = {
  accessToken: string;
  tokenType: string;
  expiresIn: string | null;
};

export const TOKEN_COOKIE_NAME = "access_token";
export const ENCRYPTED_PREFIX = "v1.";
export const ENCRYPTION_KEY_ENV = "ANILIST_TOKEN_ENCRYPTION_KEY";

export class MissingEncryptionKeyError extends Error {
  code = "ANILIST_CONFIG_MISSING";

  constructor(message = `${ENCRYPTION_KEY_ENV} is missing or not a 32-byte hex string`) {
    super(message);
    this.name = "MissingEncryptionKeyError";
  }
}

/** 64 hex characters = 32 bytes. Anything else is a configuration error. */
export function parseEncryptionKey(raw: string | undefined | null): Buffer {
  const value = (raw ?? "").trim();

  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new MissingEncryptionKeyError();

  return Buffer.from(value, "hex");
}

export function encryptionKeyFromEnv(): Buffer {
  return parseEncryptionKey(process.env[ENCRYPTION_KEY_ENV]);
}

/** AES-256-GCM: 12-byte IV, 16-byte tag, both base64url. */
export function encryptToken(token: AnilistToken, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(token), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptToken(value: string, key: Buffer): AnilistToken | null {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return null;

  const [ivPart, tagPart, dataPart] = value.slice(ENCRYPTED_PREFIX.length).split(".");

  if (!ivPart || !tagPart || !dataPart) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");

    return normaliseToken(JSON.parse(plain));
  } catch {
    return null;
  }
}

function normaliseToken(value: unknown): AnilistToken | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const accessToken = typeof record.accessToken === "string" ? record.accessToken : "";

  if (!accessToken) return null;

  return {
    accessToken,
    tokenType: typeof record.tokenType === "string" && record.tokenType ? record.tokenType : "Bearer",
    expiresIn:
      typeof record.expiresIn === "string"
        ? record.expiresIn
        : typeof record.expiresIn === "number"
          ? String(record.expiresIn)
          : null,
  };
}

/**
 * Reads either format. Returns null when there is no usable token: a missing key
 * with an encrypted cookie is a failure, never a fallback to something weaker.
 */
export function readAnilistToken(cookieValue: string | undefined | null, key?: Buffer): AnilistToken | null {
  if (!cookieValue) return null;

  if (cookieValue.startsWith(ENCRYPTED_PREFIX)) {
    let resolved = key;

    if (!resolved) {
      try {
        resolved = encryptionKeyFromEnv();
      } catch {
        return null;
      }
    }

    return decryptToken(cookieValue, resolved);
  }

  try {
    return normaliseToken(JSON.parse(cookieValue));
  } catch {
    return null;
  }
}

/** The cookie value to store for the given flow. */
export function serializeToken(token: AnilistToken, flow: "implicit" | "code", key?: Buffer): string {
  if (flow === "implicit") return JSON.stringify(token);

  return encryptToken(token, key ?? encryptionKeyFromEnv());
}
