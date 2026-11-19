// The single server-side call that turns an AniList access token into the viewer
// the UI needs. An 8 second timeout, and exactly one retry for network errors
// (never for a timeout or an HTTP error: retrying those only multiplies the wait).

import { ANILIST_GRAPHQL_URL, VIEWER_FIELDS } from "./endpoint";
import { logAnilistFailure, type AnilistErrorCode } from "./errors";

export type AnilistViewer = {
  id: number;
  name?: string | null;
  bannerImage?: string | null;
  avatar?: { large?: string | null; medium?: string | null } | null;
  options?: { titleLanguage?: string | null; displayAdultContent?: boolean | null } | null;
};

export type ViewerResult =
  | { ok: true; viewer: AnilistViewer }
  | { ok: false; code: AnilistErrorCode; status: number };

export type ViewerFetchDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export const VIEWER_TIMEOUT_MS = 8000;

const VIEWER_QUERY = `query { Viewer { ${VIEWER_FIELDS} } }`;

type Attempt = { kind: "response"; response: Response } | { kind: "timeout" } | { kind: "network"; error: unknown };

async function attemptOnce(
  accessToken: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(ANILIST_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
      body: JSON.stringify({ query: VIEWER_QUERY }),
      signal: controller.signal,
      cache: "no-store",
    });

    return { kind: "response", response };
  } catch (error) {
    const aborted = (error as { name?: string })?.name === "AbortError";

    return aborted ? { kind: "timeout" } : { kind: "network", error };
  } finally {
    clearTimeout(timer);
  }
}

function failure(code: AnilistErrorCode, status: number): ViewerResult {
  logAnilistFailure(code, status);

  return { ok: false, code, status };
}

/**
 * Fetches `Viewer` for the token. Never throws: every failure is a code.
 * `fetchImpl` is injectable so the tests do not need a network.
 */
export async function fetchAnilistViewer(
  accessToken: string,
  deps: ViewerFetchDeps = {}
): Promise<ViewerResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? VIEWER_TIMEOUT_MS;

  let attempt = await attemptOnce(accessToken, fetchImpl, timeoutMs);

  // One retry, network errors only. A timeout already burned 8 seconds.
  if (attempt.kind === "network") {
    attempt = await attemptOnce(accessToken, fetchImpl, timeoutMs);
  }

  if (attempt.kind === "timeout") return failure("ANILIST_VIEWER_TIMEOUT", 504);
  if (attempt.kind === "network") return failure("ANILIST_VIEWER_UNREACHABLE", 502);

  const { response } = attempt;

  if (response.status === 429) return failure("ANILIST_RATE_LIMITED", 429);
  if (response.status === 401 || response.status === 403) return failure("ANILIST_VIEWER_401", 401);
  if (response.status === 400) return failure("ANILIST_VIEWER_400", 400);
  if (!response.ok) return failure("ANILIST_VIEWER_UNREACHABLE", response.status);

  let payload: { data?: { Viewer?: AnilistViewer | null }; errors?: unknown } | null = null;

  try {
    payload = await response.json();
  } catch {
    return failure("ANILIST_VIEWER_UNREACHABLE", response.status);
  }

  const viewer = payload?.data?.Viewer;

  // AniList answers 200 with an `errors` array for a token it does not accept.
  if (!viewer || typeof viewer.id !== "number") return failure("ANILIST_VIEWER_401", 401);

  return { ok: true, viewer };
}
