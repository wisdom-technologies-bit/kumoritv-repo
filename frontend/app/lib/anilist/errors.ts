// Distinct, honest AniList login failures.
//
// Every error is one of these codes. The toast shows the human sentence and the
// code in small text, so a screenshot from a phone is enough to diagnose the
// failure without the access token ever leaving the server.

export const ANILIST_ERROR_CODES = [
  "ANILIST_TOKEN_MISSING",
  "ANILIST_VIEWER_400",
  "ANILIST_VIEWER_401",
  "ANILIST_VIEWER_TIMEOUT",
  "ANILIST_VIEWER_UNREACHABLE",
  "ANILIST_RATE_LIMITED",
  "ANILIST_SYNC_FAILED",
  "ANILIST_CONFIG_MISSING",
  "ANILIST_STATE_INVALID",
  "ANILIST_CODE_EXCHANGE_FAILED",
] as const;

export type AnilistErrorCode = (typeof ANILIST_ERROR_CODES)[number];

export const ANILIST_ERROR_MESSAGES: Record<AnilistErrorCode, string> = {
  ANILIST_TOKEN_MISSING: "AniList did not send a login token. Please sign in again.",
  ANILIST_VIEWER_400: "AniList could not read the login token. Please sign in again.",
  ANILIST_VIEWER_401: "AniList rejected the login token. Please sign in again.",
  ANILIST_VIEWER_TIMEOUT: "AniList took too long to answer. Check your connection and try again.",
  ANILIST_VIEWER_UNREACHABLE: "Could not reach AniList. Check your connection and try again.",
  ANILIST_RATE_LIMITED: "AniList is limiting requests right now. Please wait a minute and try again.",
  ANILIST_SYNC_FAILED: "Logged in with AniList, but saving your account failed. Please try again.",
  ANILIST_CONFIG_MISSING: "AniList login is not configured on the server. Please try again later.",
  ANILIST_STATE_INVALID: "This AniList login link is no longer valid. Please sign in again.",
  ANILIST_CODE_EXCHANGE_FAILED: "AniList did not accept the login code. Please try again.",
};

export function anilistErrorMessage(code: AnilistErrorCode): string {
  return ANILIST_ERROR_MESSAGES[code] ?? ANILIST_ERROR_MESSAGES.ANILIST_VIEWER_UNREACHABLE;
}

/** Server-side log line: the code and the HTTP status, never the token. */
export function logAnilistFailure(code: AnilistErrorCode, detail?: string | number) {
  console.error(`[anilist] code=${code}${detail === undefined ? "" : ` detail=${detail}`}`);
}
