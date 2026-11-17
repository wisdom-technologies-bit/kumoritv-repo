// Prompt 42 / Community Phase 4, part A: the new-post bar.
//
// Everything that can be decided WITHOUT a database or a request lives here, so
// the route, the toast, the pill and their tests all share one truth:
//
//   * the shape of one item of /api/community/latest
//   * the plain-text projection (Markdown stripped, 140 characters, word safe)
//   * the ETag (ids + newest created_at)
//   * nextToast() - the throttle/collapse state machine, a pure function
//
// This module has NO imports on purpose: the toast is a client component and the
// route is a server one, and neither should drag the other's dependencies in.

export const LATEST_LIMIT_DEFAULT = 5;
export const LATEST_LIMIT_MAX = 5;
/** The toast text is short by design; the feed has the whole post. */
export const LATEST_TEXT_MAX = 140;
/** One announcement / post per toast, collapsed. */
export const TOAST_VISIBLE_MS = 5_000;
export const TOAST_FADE_MS = 200;
export const TOAST_MIN_GAP_MS = 10_000;
export const POLL_SECONDS_DEFAULT = 30;
export const TOAST_SECONDS_DEFAULT = 5;
export const TOAST_MIN_GAP_SECONDS_DEFAULT = 10;
/** Back-off ceiling on errors and 429s: five minutes. */
export const POLL_BACKOFF_MAX_MS = 5 * 60_000;

export type LatestKind = "post" | "announcement";

export type LatestItem = {
  id: string;
  kind: LatestKind;
  authorId: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  /** Plain text, already stripped of Markdown and cut to LATEST_TEXT_MAX. */
  text: string;
  hasClip: boolean;
  clipThumb: string | null;
  /** Adult clip and the shared payload has nothing else to say about it. */
  adult: boolean;
  href: string;
  createdAt: string;
};

/** The raw row the SQL function returns (snake_case, like every other RPC). */
export type LatestRow = {
  id: string;
  kind: string;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
  text: string | null;
  has_clip: boolean | null;
  clip_thumb: string | null;
  adult: boolean | null;
  href: string | null;
};

/** What an adult item is allowed to say in a PUBLIC, shared-cacheable payload. */
export const ADULT_TOAST_TEXT = "New 18+ clip";

const HTML_TAG = /<\/?[a-z][^>]*>/gi;
const FENCE = /```[\s\S]*?```/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\(([^)]*)\)/g;
const AUTOLINK = /<((?:https?:|mailto:)[^>\s]+)>/gi;
const INLINE_CODE = /`([^`]*)`/g;
const HEADING = /^ {0,3}#{1,6}\s+/gm;
const BLOCKQUOTE = /^ {0,3}>\s?/gm;
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,3}[.)])\s+/gm;
const RULE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/gm;
const EMPHASIS = /(\*\*|__|\*|_|~~)/g;

/**
 * Markdown -> one line of plain text. Deliberately small: the toast, the bell
 * preview, the meta description and the push body need "what it says", not a
 * parser. Raw HTML is removed rather than interpreted (the renderer never shows
 * it either, see markdown.tsx).
 */
export function stripMarkdown(input: string | null | undefined): string {
  let text = String(input ?? "");
  if (!text) return "";

  text = text.replace(FENCE, " ");
  text = text.replace(IMAGE, "$1");
  text = text.replace(LINK, "$1");
  text = text.replace(AUTOLINK, "$1");
  text = text.replace(INLINE_CODE, "$1");
  text = text.replace(HTML_TAG, " ");
  text = text.replace(RULE, " ");
  text = text.replace(HEADING, "");
  text = text.replace(BLOCKQUOTE, "");
  text = text.replace(LIST_MARKER, "");
  text = text.replace(EMPHASIS, "");
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/** Cuts at a word boundary where one exists, so a snippet never ends mid-word. */
export function truncateWords(text: string, max = LATEST_TEXT_MAX): string {
  const clean = String(text ?? "").trim();
  if (clean.length <= max) return clean;

  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // A single unbroken token (a long URL) has no boundary: cut it, never overflow.
  const body = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,.;:!?-]+$/, "")}…`;
}

export function plainSnippet(input: string | null | undefined, max = LATEST_TEXT_MAX): string {
  return truncateWords(stripMarkdown(input), max);
}

/**
 * One row -> the public item. The adult rule lives HERE as well as in SQL: an
 * adult row can only ever surface as the generic label, whatever the database
 * sent, so a mistake in the function cannot leak a title or a thumbnail.
 */
export function shapeLatestRow(row: LatestRow): LatestItem | null {
  if (!row || typeof row.id !== "string" || !row.id) return null;
  const kind: LatestKind = row.kind === "announcement" ? "announcement" : "post";
  const adult = row.adult === true;
  const createdAt = row.created_at;
  if (!createdAt) return null;

  const href =
    typeof row.href === "string" && row.href.startsWith("/")
      ? row.href
      : kind === "announcement"
        ? `/community/announcements/${row.id}`
        : `/community/post/${row.id}`;

  if (adult) {
    return {
      id: row.id,
      kind,
      // Kept only so the author's own item can be skipped; no email, no handle.
      authorId: row.author_id ?? null,
      // The feed already shows an author name next to a masked adult card.
      authorName: row.author_name ?? null,
      authorAvatar: null,
      text: ADULT_TOAST_TEXT,
      hasClip: true,
      clipThumb: null,
      adult: true,
      href,
      createdAt,
    };
  }

  return {
    id: row.id,
    kind,
    authorId: row.author_id ?? null,
    authorName: row.author_name ?? null,
    authorAvatar: row.author_avatar ?? null,
    text: plainSnippet(row.text, LATEST_TEXT_MAX),
    hasClip: row.has_clip === true,
    clipThumb: row.clip_thumb ?? null,
    adult: false,
    href,
    createdAt,
  };
}

/** 32-bit FNV-1a. Small, deterministic, and enough for an ETag of 5 ids. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The validator: a hash of the ids plus the newest created_at. Two responses
 * with the same items and the same newest timestamp carry the same tag, and a
 * new item always changes it.
 */
export function latestETag(items: LatestItem[]): string {
  const ids = items.map((item) => `${item.kind}:${item.id}`).sort().join(",");
  const newest = items.reduce((max, item) => (item.createdAt > max ? item.createdAt : max), "");
  return `W/"${hashString(`${ids}|${newest}`)}-${items.length}"`;
}

/* -------------------------------------------------------------------------- */
/* nextToast: the state machine, as one pure function                          */
/* -------------------------------------------------------------------------- */

export type ToastState = {
  /** Newest created_at already accounted for. null = the first load. */
  cursor: string | null;
  /** Items waiting for the next toast (collapsed into one line). */
  pending: LatestItem[];
  /** When the last toast appeared, for the 10 s throttle. */
  lastShownAt: number | null;
  /** When the on-screen toast stops being on screen, so a flush knows to wait. */
  visibleUntil: number | null;
};

export type ToastContext = {
  /** Signed-in viewer: their own posts never toast. */
  viewerId?: string | null;
  /** On /community, in fullscreen, during a pre-roll, or focused in a field. */
  suppressed?: boolean;
  /** The clip toast owns the toast layer: queue, but do not show yet. */
  defer?: boolean;
  visibleMs?: number;
  minGapMs?: number;
};

export type ToastDecision = { state: ToastState; show: LatestItem[] | null };

export function initialToastState(): ToastState {
  return { cursor: null, pending: [], lastShownAt: null, visibleUntil: null };
}

function dedupe(items: LatestItem[]): LatestItem[] {
  const seen = new Set<string>();
  const out: LatestItem[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  // Newest first, so the representative is unambiguous.
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

function newestOf(items: LatestItem[], fallback: string | null): string | null {
  let newest = fallback;
  for (const item of items) if (!newest || item.createdAt > newest) newest = item.createdAt;
  return newest;
}

/**
 * Feeds one poll result into the toast state.
 *
 *   * the FIRST response only seeds the cursor: a returning visitor is never
 *     shown the backlog;
 *   * the author's own items are skipped (their cursor still advances);
 *   * while suppressed nothing is queued - the pill carries the count instead;
 *   * at most one toast per `minGapMs`; anything newer waits in `pending` and is
 *     collapsed into the NEXT toast rather than queued as its own;
 *   * called with `[]` it is a flush: pending items show once the throttle and
 *     the on-screen toast allow it.
 */
export function nextToast(
  state: ToastState,
  now: number,
  items: LatestItem[],
  context: ToastContext = {},
): ToastDecision {
  const visibleMs = context.visibleMs ?? TOAST_VISIBLE_MS;
  const minGapMs = context.minGapMs ?? TOAST_MIN_GAP_MS;
  const incoming = Array.isArray(items) ? items.filter(Boolean) : [];

  // First load: seed only, never toast the backlog.
  if (state.cursor === null) {
    return {
      state: { ...state, cursor: newestOf(incoming, null) },
      show: null,
    };
  }

  const previousCursor = state.cursor;
  const cursor = newestOf(incoming, previousCursor);
  const fresh = incoming.filter(
    (item) =>
      item.createdAt > previousCursor &&
      (!context.viewerId || item.authorId !== context.viewerId),
  );

  if (context.suppressed) {
    // The pill owns the count where the toast is suppressed. Nothing is queued.
    return { state: { ...state, cursor, pending: [] }, show: null };
  }

  const pending = fresh.length ? dedupe([...state.pending, ...fresh]) : state.pending;
  if (!pending.length) return { state: { ...state, cursor }, show: null };

  // Another toast owns the layer (the clip editor's status line). Wait, do not
  // drop: the community toast is shown as soon as the layer is free.
  if (context.defer) return { state: { ...state, cursor, pending }, show: null };

  // Still on screen: wait for the fade, then flush.
  if (state.visibleUntil !== null && now < state.visibleUntil) {
    return { state: { ...state, cursor, pending }, show: null };
  }

  // Throttled: one toast per window, no matter how many posts arrived.
  if (state.lastShownAt !== null && now < state.lastShownAt + minGapMs) {
    return { state: { ...state, cursor, pending }, show: null };
  }

  return {
    state: {
      cursor,
      pending: [],
      lastShownAt: now,
      visibleUntil: now + visibleMs,
    },
    show: pending,
  };
}

/**
 * Exponential back-off for a failing endpoint: base, 2x, 4x ... capped at five
 * minutes. A 429 may pass a Retry-After that is longer, never shorter.
 */
export function backoffDelay(attempt: number, baseMs: number, retryAfterMs = 0): number {
  const safeAttempt = Math.max(1, Math.min(Math.trunc(attempt), 10));
  const grown = baseMs * 2 ** safeAttempt;
  return Math.min(Math.max(grown, retryAfterMs), POLL_BACKOFF_MAX_MS);
}

/** When a flush could next succeed, so the component can set one timer. */
export function nextFlushAt(state: ToastState, context: ToastContext = {}): number | null {
  if (!state.pending.length) return null;
  const minGapMs = context.minGapMs ?? TOAST_MIN_GAP_MS;
  const throttledUntil = state.lastShownAt === null ? 0 : state.lastShownAt + minGapMs;
  return Math.max(throttledUntil, state.visibleUntil ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** "Ada posted" / "Ada and 2 others posted" / "3 new posts". */
export function toastHeadline(items: LatestItem[]): string {
  const first = items[0];
  if (!first) return "";
  const others = items.length - 1;

  if (first.kind === "announcement" && others === 0) return "KumoriTV posted";
  if (others === 0) return first.authorName ? `${first.authorName} posted` : "Someone posted";
  if (first.authorName) return `${first.authorName} and ${others} other${others === 1 ? "" : "s"} posted`;
  return `${items.length} new posts`;
}

/** The line under the name: the announcement title, or what the post says. */
export function toastBody(item: LatestItem): string {
  if (item.adult) return ADULT_TOAST_TEXT;
  if (item.kind === "announcement") return item.text || "New announcement";
  if (item.text) return item.text;
  return item.hasClip ? "Shared a clip" : "New post";
}

/** The mobile single line: "Ada · text". */
export function toastMobileLine(items: LatestItem[]): string {
  const first = items[0];
  if (!first) return "";
  const who = first.kind === "announcement" ? "KumoriTV" : first.authorName || "Someone";
  const others = items.length - 1;
  const message = toastBody(first);
  const more = others > 0 ? ` (+${others})` : "";
  return `${who} · ${message}${more}`;
}

/* -------------------------------------------------------------------------- */
/* Config                                                                      */
/* -------------------------------------------------------------------------- */

/** Env tuning, read per request (bracket access keeps it a runtime lookup). */
export function readLatestConfig(env: (key: string) => string | undefined): {
  pollMs: number;
  visibleMs: number;
  minGapMs: number;
} {
  const positive = (key: string, fallback: number) => {
    const value = Number(String(env(key) ?? "").trim());
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    pollMs: Math.round(positive("COMMUNITY_POLL_SECONDS", POLL_SECONDS_DEFAULT) * 1000),
    visibleMs: Math.round(positive("COMMUNITY_TOAST_SECONDS", TOAST_SECONDS_DEFAULT) * 1000),
    minGapMs: Math.round(positive("COMMUNITY_TOAST_MIN_GAP_SECONDS", TOAST_MIN_GAP_SECONDS_DEFAULT) * 1000),
  };
}

/**
 * The route's 10 s per-instance cache, kept out of the route file: Next allows a
 * route module to export only its own symbols, and the test hook below is not
 * one of them.
 *
 * It lives on `globalThis` so a dev-server module reload does not hand every
 * request a cold cache, and so a unit test can clear the exact map the route
 * uses.
 */
export const LATEST_CACHE_TTL_MS = 10_000;
export const LATEST_CACHE_MAX_ENTRIES = 100;

export type LatestCacheEntry = { at: number; etag: string; body: string };

const CACHE_KEY = Symbol.for("community.latest.cache");

type CacheHolder = { [CACHE_KEY]?: Map<string, LatestCacheEntry> };

export function latestCache(): Map<string, LatestCacheEntry> {
  const holder = globalThis as unknown as CacheHolder;
  holder[CACHE_KEY] ??= new Map<string, LatestCacheEntry>();
  return holder[CACHE_KEY]!;
}

/** Test hook: the cache must not leak between cases. */
export function clearLatestCache(): void {
  latestCache().clear();
}
