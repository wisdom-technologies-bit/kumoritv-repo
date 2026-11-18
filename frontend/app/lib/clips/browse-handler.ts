// Phase 5: GET /api/clips, with everything that touches the outside world
// injected.
//
// The route file only wires real dependencies; this handler owns the decisions
// that are worth testing: the flag (404), the rate limit (429), the database
// outage (503, never cached), the ETag (304), and the cache headers. Same shape
// as the Phase 4 `handleLatest` for the community feed, so the two public
// endpoints behave alike.

import { browseEtag, readBrowseQuery, type BrowserQuery } from "./browse";
import type { BrowsePage } from "./browse-server";
import type { RateLimiter } from "./rate-limit";

/** The public list changes slowly and is identical for everyone, so it caches. */
export const BROWSE_CACHE = "public, s-maxage=30, stale-while-revalidate=60";
export const BROWSE_NO_STORE = { "cache-control": "no-store" } as const;
/** 60 pages a minute per IP: a person scrolling hits ~6, a crawler hits the cap. */
export const BROWSE_RATE = 60;

export type BrowseDeps = {
  /** Read per request, never captured at module load. */
  enabled: () => boolean;
  load: (query: BrowserQuery) => Promise<BrowsePage>;
  limiter: RateLimiter;
  /** `null` when the platform gave us no address. */
  ip: string | null;
  rate?: number;
};

export async function handleBrowse(request: Request, deps: BrowseDeps): Promise<Response> {
  if (!deps.enabled()) {
    // Not "403": with the flag off the endpoint does not exist, so nothing
    // hints at a private list behind it.
    return Response.json({ error: "not_found" }, { status: 404, headers: BROWSE_NO_STORE });
  }

  const url = new URL(request.url);
  const query = readBrowseQuery({
    sort: url.searchParams.get("sort"),
    anime: url.searchParams.get("anime"),
    q: url.searchParams.get("q"),
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  });

  const decision = deps.limiter.check(`clips:${deps.ip ?? "unknown"}`, deps.rate ?? BROWSE_RATE);
  if (!decision.allowed) {
    return Response.json(
      { error: "rate_limited", message: "Too many requests. Try again in a moment." },
      {
        status: 429,
        headers: { ...BROWSE_NO_STORE, "retry-after": String(decision.retryAfterSeconds) },
      },
    );
  }

  const page = await deps.load(query);
  if (page.failed) {
    // Never cache a database outage for thirty seconds.
    return Response.json({ error: "unavailable" }, { status: 503, headers: BROWSE_NO_STORE });
  }

  const body = JSON.stringify({ items: page.items, nextCursor: page.nextCursor });
  const etag = browseEtag(body);
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": BROWSE_CACHE } });
  }

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      etag,
      "cache-control": BROWSE_CACHE,
      // One body for everyone is the design; say so rather than let a proxy
      // think a cookie or a language changes it.
      vary: "accept-encoding",
    },
  });
}
