// Pure helpers for the AniList implicit-grant login: no React, no redux, no
// network, so the flow can be unit tested and reused by the route handlers.

export type AnilistToken = {
  accessToken: string;
  tokenType: string;
  expiresIn: string | null;
};

export type ParsedAnilistRedirect = {
  token: AnilistToken | null;
  /** AniList's `error` code (`access_denied`, `invalid_request`, ...) when present. */
  error: string | null;
};

export const ANILIST_AUTHORIZE_ENDPOINT = "https://anilist.co/api/v2/oauth/authorize";

export const DEFAULT_TOKEN_TYPE = "Bearer";

/** AniList tokens live a year; never set a cookie longer than that. */
export const ANILIST_COOKIE_MAX_AGE_CAP = 60 * 60 * 24 * 365;

/** Used when AniList omits `expires_in` from the redirect. */
export const ANILIST_COOKIE_MAX_AGE_DEFAULT = 60 * 60 * 24 * 30;

/** Event used to surface login notices (the toast listens for it). */
export const ANILIST_NOTICE_EVENT = "anilist:notice";

/**
 * Reads the parameters AniList redirects back with. The values arrive in the hash
 * (`#access_token=...&token_type=...&expires_in=...`), but an error comes back in
 * the query string (`?error=access_denied`), so the raw value is accepted either way.
 */
export function parseAnilistRedirect(raw: string): ParsedAnilistRedirect {
  if (!raw) return { token: null, error: null };

  const cleaned = raw.replace(/^[#?]+/, "");
  const params = new URLSearchParams(cleaned);

  const error = params.get("error") || params.get("error_description");
  if (error) return { token: null, error };

  const accessToken = params.get("access_token");
  if (!accessToken) return { token: null, error: null };

  return {
    token: {
      accessToken,
      tokenType: params.get("token_type") || DEFAULT_TOKEN_TYPE,
      expiresIn: params.get("expires_in"),
    },
    error: null,
  };
}

export function hasAnilistRedirect(raw: string): boolean {
  if (!raw) return false;

  const params = new URLSearchParams(raw.replace(/^[#?]+/, ""));

  return Boolean(params.get("access_token") || params.get("error"));
}

/** The authorize URL. No redirect_uri: AniList uses the one registered on the app. */
export function anilistAuthorizeUrl(clientId?: string | null): string | null {
  const id = (clientId ?? "").trim();
  if (!id) return null;

  return `${ANILIST_AUTHORIZE_ENDPOINT}?client_id=${encodeURIComponent(id)}&response_type=token`;
}

export function describeAnilistError(code: string | null): string {
  switch (code) {
    case "access_denied":
      return "AniList login was cancelled.";
    case "invalid_request":
    case "invalid_client":
    case "unsupported_response_type":
      return "AniList rejected the login request. Check the app configuration.";
    case "temporarily_unavailable":
      return "AniList is unavailable right now. Please try again in a moment.";
    default:
      return "AniList login failed. Please try again.";
  }
}

export const BRIDGE_FAILURE_NOTICE =
  "Logged in with AniList, but syncing your account failed. Some features may not save.";

/** Cookie lifetime in seconds, from the token's `expires_in`. */
export function anilistCookieMaxAge(expiresIn?: string | number | null): number {
  const seconds = Number(expiresIn);

  if (!Number.isFinite(seconds) || seconds <= 0) return ANILIST_COOKIE_MAX_AGE_DEFAULT;

  return Math.min(Math.floor(seconds), ANILIST_COOKIE_MAX_AGE_CAP);
}

/** Absolute-ish request URL: relative in the browser, absolute inside the route. */
export function apiPath(path: string, origin?: string | null): string {
  const base = (origin ?? "").replace(/\/$/, "");

  return `${base}${path}`;
}
