// Phase 5: the database side of the public clip browse.
//
// Two queries per page, never one per row:
//   1. one page of `clips` (keyset, soft-deleted excluded);
//   2. one batched `anime` lookup for that page's ids;
//   3. one batched `profiles` lookup for that page's authors.
// A search adds a third small query that resolves the matching anime ids first,
// because `clips` stores `anilist_id` and the title lives next door. That is
// still O(1) queries per page, and it keeps the wildcard escaping in one place.

import "server-only";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { getAnimeSummaries, type AnimeSummary } from "./server";
import {
  CLIPS_WEEK_MS,
  likePattern,
  nextCursorFor,
  sortKey,
  toBrowseItem,
  type BrowseClipRow,
  type BrowseItem,
  type BrowserQuery,
  type ClipsSort,
  type CursorPayload,
} from "./browse";

const SELECT =
  "id,code,anilist_id,episode_number,start_seconds,end_seconds,views,created_at,user_id";
const ANIME_MATCH_LIMIT = 400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function db(): any | null {
  return createAdminClient();
}

/** Timestamps go into a PostgREST filter, so they are quoted, never raw. */
function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The keyset condition for "strictly after this row" in a descending order.
 * Written as one PostgREST `or`, because a keyset page must never skip a row
 * whose sort key ties the cursor (two clips created in the same millisecond):
 * `key < K or (key = K and id < I)`.
 */
export function keysetOr(sort: ClipsSort, after: CursorPayload | null): string | null {
  if (!after) return null;
  if (sort === "views") {
    const views = Number(after.key);
    if (!Number.isFinite(views)) return null;
    return `views.lt.${views},and(views.eq.${views},id.lt.${after.id})`;
  }
  const createdAt = String(after.key);
  if (Number.isNaN(Date.parse(createdAt))) return null;
  const stamp = quoted(createdAt);
  return `created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${after.id})`;
}

/** The `week` window is relative to "now", so it is computed per request. */
export function weekFloor(now: number): string {
  return new Date(now - CLIPS_WEEK_MS).toISOString();
}

/**
 * The anime ids whose title matches `q`, or an empty list when nothing matches.
 * Matching is case-insensitive and literal: `%`, `_` and `,` in the query are
 * escaped, so "100%" cannot become "anything".
 */
export async function findAnimeIdsByTitle(q: string): Promise<number[]> {
  const client = db();
  if (!client || !q) return [];
  const pattern = quoted(likePattern(q));
  const or = ["title", "title_english", "title_romaji"]
    .map((column) => `${column}.ilike.${pattern}`)
    .join(",");
  try {
    const { data, error } = await client
      .from("anime")
      .select("anilist_id")
      .or(or)
      .limit(ANIME_MATCH_LIMIT);
    if (error) return [];
    return ((data as Array<{ anilist_id: number }> | null) ?? [])
      .map((row) => Number(row.anilist_id))
      .filter((id) => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

export type ClipPageQuery = {
  sort: ClipsSort;
  anime: number | null;
  /** Resolved search matches; `null` means "no search", `[]` means "no match". */
  animeIds: number[] | null;
  minCreatedAt: string | null;
  after: CursorPayload | null;
  limit: number;
};

/** One page from `clips`, one row longer than asked so "has more" is free. */
export async function listBrowseClips(query: ClipPageQuery): Promise<BrowseClipRow[]> {
  const client = db();
  if (!client) return [];
  if (query.animeIds !== null && query.animeIds.length === 0) return [];

  try {
    let builder = client
      .from("clips")
      .select(SELECT)
      .is("deleted_at", null);

    if (query.anime != null) builder = builder.eq("anilist_id", query.anime);
    if (query.animeIds !== null) builder = builder.in("anilist_id", query.animeIds);
    if (query.minCreatedAt) builder = builder.gte("created_at", query.minCreatedAt);

    const keyset = keysetOr(query.sort, query.after);
    if (keyset) builder = builder.or(keyset);

    builder =
      query.sort === "views"
        ? builder.order("views", { ascending: false }).order("id", { ascending: false })
        : builder.order("created_at", { ascending: false }).order("id", { ascending: false });

    const { data, error } = await builder.limit(query.limit + 1);
    if (error) return [];
    return (data as BrowseClipRow[] | null) ?? [];
  } catch {
    return [];
  }
}

/** display_name, else username, else null: null is what the client shows as "Guest". */
export async function authorNames(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const client = db();
  const ids = [...new Set(userIds.filter((id) => UUID.test(id)))];
  if (!client || ids.length === 0) return map;
  try {
    const { data } = await client
      .from("profiles")
      .select("id, username, display_name")
      .in("id", ids);
    for (const row of (data as Array<{ id: string; username: string | null; display_name: string | null }> | null) ??
      []) {
      const name = (row.display_name ?? "").trim() || (row.username ?? "").trim();
      if (name) map.set(row.id, name);
    }
  } catch {
    /* the card falls back to "Guest" rather than failing the page */
  }
  return map;
}

export type BrowsePage = {
  items: BrowseItem[];
  nextCursor: string | null;
  /** True when the database could not be reached: the page shows its error state. */
  failed: boolean;
};

/**
 * The whole page, ready for JSON. `now` is injectable so the `week` window is
 * testable without freezing the clock.
 */
export async function loadBrowsePage(query: BrowserQuery, now: number = Date.now()): Promise<BrowsePage> {
  if (!db()) return { items: [], nextCursor: null, failed: true };

  const animeIds = query.q ? await findAnimeIdsByTitle(query.q) : null;
  const rows = await listBrowseClips({
    sort: query.sort,
    anime: query.anime,
    animeIds,
    minCreatedAt: query.sort === "week" ? weekFloor(now) : null,
    after: query.after,
    limit: query.limit,
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  const anime: Map<number, AnimeSummary> = await getAnimeSummaries(
    page.map((row) => Number(row.anilist_id)),
  );
  const authors = await authorNames(page.map((row) => row.user_id ?? ""));

  const items = page.map((row) =>
    toBrowseItem({
      row,
      anime: anime.get(Number(row.anilist_id)) ?? null,
      authorName: row.user_id ? authors.get(row.user_id) ?? null : null,
    }),
  );

  return { items, nextCursor: nextCursorFor(page, query.sort, hasMore), failed: false };
}

/** Only used by tests and by the page when it needs the same ordering rule. */
export { sortKey };
