// Which OAuth grant the AniList login uses.
//
// `implicit` (default) keeps the existing behaviour exactly: AniList redirects back
// with `#access_token=...`, the browser parses the fragment and posts the token to
// /api/auth/anilist-session. `code` sends the visitor through
// /auth/anilist/start -> AniList -> /auth/anilist/callback, where the code is
// exchanged server side and the token is stored encrypted in an httpOnly cookie.

export type AnilistAuthFlow = "implicit" | "code";

export const ANILIST_AUTH_FLOW_ENV = "ANILIST_AUTH_FLOW";

export const ANILIST_AUTH_FLOW: AnilistAuthFlow =
  (process.env.ANILIST_AUTH_FLOW ?? "").trim().toLowerCase() === "code" ? "code" : "implicit";

export function isCodeFlow(): boolean {
  return ANILIST_AUTH_FLOW === "code";
}
