// Phase 5: the public clip browse, as pure functions.
//
// Everything here is testable without a database or a request: parameter
// parsing, the opaque keyset cursor, the ILIKE escape, the row -> response
// mapping (including the adult rule), and the ETag. The route and the page only
// wire these to Supabase.
//
// ADULT RULE (owner's decision, same as the community feed): a clip on an adult
// (hentai) title is LISTED, so the list is honest about what exists, but the
// shared, publicly cached response carries no thumbnail, no anime title, no
// episode, no time range and no author for it. The response is byte-identical
// for everyone, which is what makes `Cache-Control: public` safe; the client
// decides whether to draw a placeholder ("Adult content 18+") or a muted card
// that opens the clip page, where the normal adult gate applies.
//
// Hidden/removed clips never appear: every query filters `deleted_at is null`,
// and a soft-deleted row is therefore invisible here even though it survives
// for the report trail.

import { formatRange } from "./time";

export const CLIPS_SORTS = ["latest", "views", "week"] as const;

export type ClipsSort = (typeof CLIPS_SORTS)[number];

/** The default page. Deliberately the same number as the spec's `limit=24`. */
export const CLIPS_BROWSE_LIMIT = 24;
/** A page can ask for more (the "Load more" button uses the default), never less than 1. */
export const CLIPS_BROWSE_MAX_LIMIT = 48;
/** `week` means "created in the last seven days", not a calendar week. */
export const CLIPS_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** A one-character search matches half the catalogue, so it is not a search. */
export const CLIPS_SEARCH_MIN = 2;
export const CLIPS_SEARCH_MAX = 80;

export type BrowserQuery = {
  sort: ClipsSort;
  /** AniList id, or null for every title. */
  anime: number | null;
  /** Trimmed search text, or null. Case is preserved; matching is case-insensitive. */
  q: string | null;
  limit: number;
  /** Decoded keyset cursor, or null for the first page. */
  after: CursorPayload | null;
};

export type CursorPayload = {
  /** Bumped only if the cursor's meaning changes; a stale cursor is ignored. */
  v: 1;
  sort: ClipsSort;
  /** The sort key of the last row (created_at ISO string, or a number for views). */
  key: string | number;
  /** Tie-break: the last row's id. */
  id: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSort(value: unknown): value is ClipsSort {
  return typeof value === "string" && (CLIPS_SORTS as readonly string[]).includes(value);
}

/** Accepts the first value of a repeated param; anything else is the default. */
function first(value: string | string[] | undefined | null): string | null {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
  return typeof value === "string" ? value : null;
}

/**
 * One parser for the route and for the page, so a URL the browser builds and a
 * URL the page reads can never mean different things. Never throws.
 */
export function readBrowseQuery(input: {
  sort?: string | string[] | undefined | null;
  anime?: string | string[] | undefined | null;
  q?: string | string[] | undefined | null;
  cursor?: string | string[] | undefined | null;
  limit?: string | string[] | undefined | null;
}): BrowserQuery {
  const sortValue = first(input.sort);
  const sort: ClipsSort = isSort(sortValue) ? sortValue : "latest";

  const animeRaw = (first(input.anime) ?? "").trim();
  const animeNumber = Number(animeRaw);
  const anime =
    /^\d{1,10}$/.test(animeRaw) && Number.isInteger(animeNumber) && animeNumber > 0
      ? animeNumber
      : null;

  // Whitespace is not a search; below the minimum it is also not a search. It is
  // silently dropped rather than 400ing, because a half-typed query in the URL
  // should show the full list, not an error page.
  const qRaw = (first(input.q) ?? "").replace(/\s+/g, " ").trim();
  const q = qRaw.length >= CLIPS_SEARCH_MIN ? qRaw.slice(0, CLIPS_SEARCH_MAX) : null;

  const limitRaw = Number((first(input.limit) ?? "").trim());
  const limit =
    Number.isInteger(limitRaw) && limitRaw >= 1
      ? Math.min(limitRaw, CLIPS_BROWSE_MAX_LIMIT)
      : CLIPS_BROWSE_LIMIT;

  const decoded = decodeCursor(first(input.cursor));
  // A cursor is only meaningful for the sort it was minted for: reusing a
  // "views" cursor on "latest" would silently skip rows, so it is ignored.
  const after = decoded && decoded.sort === sort ? decoded : null;

  return { sort, anime, q, limit, after };
}

/**
 * The cursor is opaque on purpose (base64url of JSON). It carries no secret and
 * no viewer data: only the sort, the last sort key and the last id, which is
 * exactly what a keyset page needs.
 */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify({ v: 1, s: payload.sort, k: payload.key, i: payload.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): CursorPayload | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  // base64url only: no padding, no spaces, nothing that could smuggle a JSON
  // document of the caller's own choosing.
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1) return null;
  if (!isSort(value.s)) return null;
  if (typeof value.i !== "string" || !UUID.test(value.i)) return null;
  const key = value.k;
  if (typeof key !== "string" && typeof key !== "number") return null;
  if (typeof key === "number" && !Number.isFinite(key)) return null;
  return { v: 1, sort: value.s, key, id: value.i };
}

/**
 * PostgREST treats `%` and `_` inside an ILIKE pattern as wildcards and `,` and
 * `)` as filter syntax. Escaping them means a search for "100%" finds the
 * literal text, and a search for "a,b" cannot rewrite the query.
 */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** The `q` a viewer actually typed, ready for a PostgREST `ilike` pattern. */
export function likePattern(q: string): string {
  return `%${escapeLike(q)}%`;
}

export type BrowseClipRow = {
  id: string;
  code: string;
  anilist_id: number;
  episode_number: number;
  start_seconds: number;
  end_seconds: number;
  views: number;
  created_at: string;
  user_id: string | null;
};

export type BrowseAnime = {
  anilistId: number;
  title: string | null;
  isAdult: boolean;
};

export type BrowseItem = {
  code: string;
  anilistId: number | null;
  animeTitle: string | null;
  episode: number | null;
  start: number | null;
  end: number | null;
  durationSec: number | null;
  views: number;
  createdAt: string;
  authorName: string | null;
  thumb: string | null;
  adult: boolean;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * One row -> one item. `adult` comes from the joined anime row, and an adult
 * clip loses every identifying field at this point, server side, so nothing
 * adult can leak through a proxy cache or a screenshot of the JSON.
 */
export function toBrowseItem({
  row,
  anime,
  authorName,
}: {
  row: BrowseClipRow;
  anime: BrowseAnime | null;
  authorName: string | null;
}): BrowseItem {
  const adult = anime?.isAdult === true;
  const anilistId = num(row.anilist_id);
  const episode = num(row.episode_number);
  const views = num(row.views);
  const createdAt = row.created_at;

  if (adult) {
    return {
      code: row.code,
      anilistId: null,
      animeTitle: null,
      episode: null,
      start: null,
      end: null,
      durationSec: null,
      views,
      createdAt,
      authorName: null,
      thumb: null,
      adult: true,
    };
  }

  const start = num(row.start_seconds);
  const end = num(row.end_seconds);
  return {
    code: row.code,
    anilistId,
    animeTitle: anime?.title ?? null,
    episode,
    start,
    end,
    durationSec: Math.max(0, Math.round((end - start) * 10) / 10),
    views,
    createdAt,
    authorName,
    thumb: anilistId && episode ? `/thumb/${anilistId}/${episode}` : null,
    adult: false,
  };
}

/** The sort key for a row, used both for ordering and for the next cursor. */
export function sortKey(row: BrowseClipRow, sort: ClipsSort): string | number {
  return sort === "views" ? num(row.views) : row.created_at;
}

/** The cursor pointing just after the last row of a page, or null when done. */
export function nextCursorFor(
  rows: BrowseClipRow[],
  sort: ClipsSort,
  hasMore: boolean,
): string | null {
  if (!hasMore || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return encodeCursor({ v: 1, sort, key: sortKey(last, sort), id: last.id });
}

/**
 * A weak ETag over the exact body. Weak is correct here: the body is a cacheable
 * representation and compression may change the bytes, but "did this list
 * change" is exactly what the client asks.
 */
export function browseEtag(body: string): string {
  // FNV-1a, 32 bits: the collision risk is irrelevant for a 30 s cache and it
  // keeps the ETag short. The length is mixed in so truncation cannot collide.
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `W/"${hash.toString(16)}-${body.length.toString(16)}"`;
}

/** "12.4k" from 12400, "999" from 999, "1.2m" from 1_200_000. */
export function formatViews(value: unknown): string {
  const views = num(value);
  if (views < 1000) return String(views);
  if (views < 1_000_000) {
    const thousands = views / 1000;
    return `${thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
  }
  return `${Math.round((views / 1_000_000) * 10) / 10}m`;
}

/** "3d ago" / "5h ago" / "just now", from an ISO string and a reference time. */
export function relativeAge(createdAt: string, now: number = Date.now()): string {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return "";
  const seconds = Math.max(0, Math.floor((now - created) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** "E4 · 0:42-0:57" - the one line under a clip's title. */
export function episodeLine(item: Pick<BrowseItem, "episode" | "start" | "end">): string {
  if (item.episode == null || item.start == null || item.end == null) return "";
  return `E${item.episode} · ${formatRange(item.start, item.end)}`;
}

/** The `/clips` query string for a filter set, with defaults kept out. */
export function filterQueryString(next: { sort: ClipsSort; q: string; anime: number | null }): string {
  const params = new URLSearchParams();
  if (next.sort !== "latest") params.set("sort", next.sort);
  if (next.q) params.set("q", next.q);
  if (next.anime != null) params.set("anime", String(next.anime));
  const value = params.toString();
  return value ? `?${value}` : "";
}

/**
 * "Back to clips" from the clip page, restoring the filters the reader came
 * from. The parameter is untrusted, so it is re-parsed by the same reader the
 * page uses and rebuilt from known fields - never echoed. Anything odd becomes
 * plain /clips.
 */
export function clipsBackHref(from: string | string[] | undefined | null): string {
  const raw = Array.isArray(from) ? from[0] : from;
  if (typeof raw !== "string" || raw.length === 0) return "/clips";
  // Accept "?sort=views&q=naruto" or "sort=views&q=naruto".
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const query = readBrowseQuery({
    sort: params.get("sort"),
    anime: params.get("anime"),
    q: params.get("q"),
  });
  return `/clips${filterQueryString({ sort: query.sort, q: query.q ?? "", anime: query.anime })}`;
}

/** Where a card links. The real route is /clip/{code} (singular), not /clips/{code}. */
export function clipHref(code: string, from?: string | null): string {
  return from ? `/clip/${code}?from=${encodeURIComponent(from)}` : `/clip/${code}`;
}

/** The shareable absolute-ish path used by "Copy link". */
export function clipSharePath(code: string): string {
  return `/clip/${code}`;
}
