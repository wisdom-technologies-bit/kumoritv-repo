// One source of truth for the AniList endpoints.
//
// `NEXT_PUBLIC_ANILIST_API_URL` used to be read with no fallback in
// `api/anilist/anilistUsers.ts`: when the variable was missing from the build the
// request went to the literal string "undefined" and every AniList call failed
// with the generic "AniList login failed" toast. The bridge route already had the
// fallback; now both read it from here.

const configured = (process.env.NEXT_PUBLIC_ANILIST_API_URL ?? "").trim();

/** AniList's public GraphQL endpoint. Overridable for a local mock. */
export const ANILIST_GRAPHQL_URL = configured || "https://graphql.anilist.co";

/** Where the authorization-code grant exchanges its code (server to server). */
export const ANILIST_TOKEN_ENDPOINT = "https://anilist.co/api/v2/oauth/token";

/** Where the visitor is sent to authorise KumoriTV. */
export const ANILIST_AUTHORIZE_ENDPOINT = "https://anilist.co/api/v2/oauth/authorize";

/** The only fields the UI needs from `Viewer`. Kept in one place so the bridge
 *  route and the (still used) server helpers ask for the same thing. */
export const VIEWER_FIELDS = `
  id
  name
  bannerImage
  avatar { large medium }
  options { titleLanguage displayAdultContent }
`;
