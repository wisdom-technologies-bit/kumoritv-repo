// Username prefix search for the @-mention picker.
//
// Signed-in only. Returns `{ username, avatar_url }` and nothing else: no ids, no
// emails, no timestamps. Lives here rather than in the route module so the route
// exports only its handler (Next type-checks a route's exports).

import { createClient } from "@/app/lib/supabase/server";

/** Rows the picker can show. */
export const USER_SEARCH_LIMIT = 6;
/** Shortest useful prefix. One character is enough to start narrowing. */
export const USER_SEARCH_MIN_QUERY = 1;
/** Longest prefix we bother looking up. */
export const USER_SEARCH_MAX_QUERY = 40;

/**
 * Simple per-user rate limit, per server instance: 30 lookups per minute is far
 * more than typing ever needs and stops a script from scraping usernames.
 */
export const USER_SEARCH_RATE_LIMIT = 30;
export const USER_SEARCH_RATE_WINDOW_MS = 60_000;

type RateEntry = { count: number; resetAt: number };
const rateLimit = new Map<string, RateEntry>();

export function __resetUserSearchRateLimitForTests(): void {
  rateLimit.clear();
}

function takeToken(userId: string, now = Date.now()): boolean {
  const entry = rateLimit.get(userId);

  if (!entry || entry.resetAt <= now) {
    rateLimit.set(userId, { count: 1, resetAt: now + USER_SEARCH_RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= USER_SEARCH_RATE_LIMIT) return false;

  entry.count += 1;
  return true;
}

export type SearchClient = {
  auth?: { getUser?: () => Promise<{ data?: { user?: { id?: string } | null } | null }> };
  from?: (table: string) => any;
};

let clientFactory: () => SearchClient | null = () => createClient();

/** Test seam, matching the `__setAdminClientForTests` pattern used elsewhere. */
export function __setUserSearchClientForTests(factory: (() => SearchClient | null) | null): void {
  clientFactory = factory ?? (() => createClient());
}

type SearchRow = { username: string | null; avatar_url: string | null };

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleUserSearch(request: Request): Promise<Response> {
  const client = clientFactory();
  if (!client) return json({ error: "unavailable", users: [] }, 503);

  let userId: string | null = null;
  try {
    const { data } = (await client.auth?.getUser?.()) ?? {};
    userId = data?.user?.id ?? null;
  } catch {
    userId = null;
  }

  if (!userId) return json({ error: "unauthorized", users: [] }, 401);
  if (!takeToken(userId)) return json({ error: "rate_limited", users: [] }, 429);

  const raw = new URL(request.url).searchParams.get("q") ?? "";
  const query = raw.trim().replace(/^@+/, "").slice(0, USER_SEARCH_MAX_QUERY);

  if (query.length < USER_SEARCH_MIN_QUERY) return json({ users: [] });

  // Prefix match only. LIKE wildcards in the input are escaped so "a%b" is
  // searched literally instead of matching everything.
  const escaped = query.replace(/[\\%_]/g, (match: string) => `\\${match}`);

  try {
    const { data, error } = await client.from!("profiles")
      .select("username, avatar_url")
      .not("username", "is", null)
      .ilike("username", `${escaped}%`)
      .order("username", { ascending: true })
      .limit(USER_SEARCH_LIMIT);

    if (error) return json({ error: "search_failed", users: [] }, 500);

    const users = ((data ?? []) as SearchRow[])
      .filter((row): row is { username: string; avatar_url: string | null } =>
        typeof row?.username === "string" && row.username.length > 0,
      )
      .map((row) => ({ username: row.username, avatar_url: row.avatar_url ?? null }));

    return json({ users });
  } catch {
    return json({ error: "search_failed", users: [] }, 500);
  }
}
