// GET /api/community/latest?after=<cursor>&limit=5
//
// Phase 4, part A. The public feed of "what just appeared", for the new-post
// bar. Three things decide its shape:
//
//   1. THE PAYLOAD IS VIEWER-INDEPENDENT. The same bytes are shared by every
//      visitor, so the response can be cached at the edge and by the browser.
//      That is also why an adult item is generic here: there is no per-viewer
//      variant to cache. See `shapeLatestRow`.
//   2. ETag + 304. The steady state is a conditional request and an empty body,
//      so a 30 s poll costs a request line and (with the 10 s cache warm) no
//      database work at all.
//   3. THE FLAG COMES FIRST. With COMMUNITY_ENABLED off this answers 404 before
//      touching a database client.
//
// The read itself is one SQL function (`community_latest`, docs/sql/
// community-phase-4.sql) so the adult rule, the `[deleted]` rule and the
// "published only" rule are enforced in the same place the feed enforces them.
import { clientIp } from "@/app/lib/clips/request";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { latestLimiter, LATEST_PER_MINUTE } from "@/app/lib/community/rate-limit";
import {
  CURSOR_SAFETY_MS,
  LATEST_CACHE_MAX_ENTRIES,
  LATEST_CACHE_TTL_MS,
  latestCache,
  LATEST_LIMIT_DEFAULT,
  LATEST_LIMIT_MAX,
  latestETag,
  shapeLatestRow,
  timeOf,
  type LatestItem,
  type LatestRow,
} from "@/app/lib/community/latest";
import { createAdminClient } from "@/app/lib/supabase/admin";


export type LatestReader = (options: { after: string | null; limit: number }) => Promise<LatestRow[] | null>;

export type LatestDeps = {
  reader?: LatestReader;
  now?: () => number;
  ip?: string;
  limiter?: { check: (key: string, limit: number, now?: number) => { allowed: boolean; retryAfterSeconds: number } };
};

// 5 s at the edge and 10 s of stale-while-revalidate: the longest a new item can
// be hidden is 15 s, half of the 30 s poll, so it can never lose a full cycle.
const CACHE_CONTROL = "public, s-maxage=5, stale-while-revalidate=10";

/**
 * The first poll has no cursor. The SQL function deliberately returns nothing
 * when `p_after` is null (there is no "first page" concept there), so a null
 * cursor is read from the beginning of time instead and the SERVER decides the
 * seed. This is the difference between a bar that works and one that never
 * shows anything: without it every poll looks like a first load forever.
 */
const SEED_FLOOR = "1970-01-01T00:00:00.000Z";

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": CACHE_CONTROL,
      ...headers,
    },
  });
}

/** The one shape this route needs from the client: the new RPC. */
type LatestRpcClient = {
  rpc: (
    name: "community_latest",
    args: { p_after: string | null; p_limit: number },
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

/** The one reader the route uses in production. */
function databaseReader(): LatestReader {
  return async ({ after, limit }) => {
    const client = createAdminClient({ noStore: true }) as unknown as LatestRpcClient | null;
    if (!client) throw new Error("supabase_not_configured");
    const { data, error } = await client.rpc("community_latest", {
      p_after: after,
      p_limit: limit,
    });
    if (error) throw new Error(String(error.message ?? "community_latest failed"));
    return (data ?? []) as LatestRow[];
  };
}

/** `after` must be a real ISO instant; anything else is a client bug, not a cursor. */
function parseCursor(raw: string | null): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === "") return { ok: true, value: null };
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: new Date(parsed).toISOString() };
}

function parseLimit(raw: string | null): number {
  // `Number(null)` is 0, which used to turn a request without `limit` into a
  // page of ONE item. Absent and blank both mean "the default".
  if (raw === null || raw.trim() === "") return LATEST_LIMIT_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return LATEST_LIMIT_DEFAULT;
  return Math.min(Math.max(Math.trunc(value), 1), LATEST_LIMIT_MAX);
}

export async function handleLatest(request: Request, deps: LatestDeps = {}): Promise<Response> {
  if (!isCommunityEnabled()) {
    return jsonResponse({ error: "not_found" }, 404, { "cache-control": "no-store" });
  }

  const now = deps.now ?? Date.now;
  const ip = deps.ip ?? clientIp(request);
  const limiter = deps.limiter ?? latestLimiter;
  const decision = limiter.check(`latest:${ip}`, LATEST_PER_MINUTE);
  if (!decision.allowed) {
    return jsonResponse(
      { error: "rate_limited", message: "Too many requests. Try again in a moment." },
      429,
      { "cache-control": "no-store", "retry-after": String(decision.retryAfterSeconds) },
    );
  }

  const url = new URL(request.url);
  const cursor = parseCursor(url.searchParams.get("after"));
  if (!cursor.ok) {
    return jsonResponse({ error: "bad_cursor", message: "`after` must be an ISO timestamp." }, 400, {
      "cache-control": "no-store",
    });
  }
  const after = cursor.value;
  const limit = parseLimit(url.searchParams.get("limit"));
  const key = `${after ?? ""}|${limit}`;

  const cache = latestCache();
  const cached = cache.get(key);
  const at = now();

  if (cached && at - cached.at < LATEST_CACHE_TTL_MS) {
    const ifNoneMatch = request.headers.get("if-none-match")?.trim();
    if (ifNoneMatch && ifNoneMatch === cached.etag) {
      return new Response(null, { status: 304, headers: { etag: cached.etag, "cache-control": CACHE_CONTROL } });
    }
    return new Response(cached.body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": CACHE_CONTROL,
        etag: cached.etag,
      },
    });
  }

  // The cursor is inclusive: read from one millisecond BEFORE it and let the
  // client drop what it has already counted. Two items can share a millisecond,
  // and `created_at > cursor` would otherwise lose the second one forever.
  const afterMs = timeOf(after);
  const readFrom = after === null ? SEED_FLOOR : new Date(Math.max(0, afterMs - 1)).toISOString();

  let rows: LatestRow[] | null = null;
  try {
    rows = await (deps.reader ?? databaseReader())({ after: readFrom, limit });
  } catch (error) {
    console.error("[community] latest read failed", error);
    return jsonResponse({ error: "unavailable", message: "Community is unavailable right now." }, 503, {
      "cache-control": "no-store",
    });
  }

  // One row per (kind,id): the SQL unions two sources and a re-read of the
  // boundary instant must never duplicate an item.
  const byKey = new Map<string, LatestItem>();
  for (const row of rows ?? []) {
    const item = shapeLatestRow(row);
    if (item) byKey.set(`${item.kind}:${item.id}`, item);
  }
  const items: LatestItem[] = [...byKey.values()]
    .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt))
    .slice(0, limit);
  items.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));

  const etag = latestETag(items);
  // The seed always comes from the server. With no items at all (an empty or
  // fully hidden community) it is "now" minus a safety margin, so the next poll
  // is a normal poll and the first real post is shown, not swallowed.
  const newestMs = items.reduce((max, item) => Math.max(max, timeOf(item.createdAt)), 0);
  const cursorMs = after === null
    ? newestMs || Math.max(0, now() - CURSOR_SAFETY_MS)
    : Math.max(afterMs, newestMs);
  const responseCursor = new Date(cursorMs).toISOString();
  const body = JSON.stringify({ items, cursor: responseCursor });

  if (cache.size >= LATEST_CACHE_MAX_ENTRIES) cache.clear();
  cache.set(key, { at, etag, body });

  const ifNoneMatch = request.headers.get("if-none-match")?.trim();
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": CACHE_CONTROL } });
  }

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": CACHE_CONTROL,
      etag,
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleLatest(request);
}
