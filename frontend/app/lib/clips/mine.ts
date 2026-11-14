// Prompt 38F: GET /api/clips/mine - the clip picker's source.
//
// "My recent clips" is the union of two things, because a clip can be made
// before signing in:
//   1. clips whose user_id is the session user;
//   2. clips made as a guest on this browser (user_id is null, owner_token_hash
//      matching the owner cookie), which is what makes the picker useful the
//      first time someone signs in.
// Deduplicated by id, newest first, twenty rows.
//
// WHO MAY CALL IT: a real signed-in account. A guest has no session and an
// anonymous Supabase session is not an account, so both get 401
// sign_in_required - they cannot post either, so a picker for them would be a
// dead end. Another browser's clips are never returned: query 1 is keyed on the
// session id and query 2 on a hash only that browser's cookie can produce.
//
// THE ADULT RULE
//   A clip on an adult title is listed as `{code, isAdult: true, hidden: true}`
//   and nothing else when the viewer's adult-content setting is off: no title,
//   no anime, no episode, no range, no thumbnail to build. The setting is the
//   site's existing preference (profile show_adult, else the
//   is_adult_content_enabled cookie, default off) and it is a display
//   preference, not age verification. With the setting on, the row is complete.

import { CLIP_MINE_LIMIT, CLIPS_PAGE_SIZE } from "@/app/lib/clips/constants";
import type { RateLimiter } from "@/app/lib/clips/rate-limit";
import type { AnimeSummary, ClipRow } from "@/app/lib/clips/server";

/** 30 lookups a minute per session: the picker opens often, so this is generous. */
export const CLIP_MINE_RATE = 30;

export type MineSession = { userId: string | null; isAnonymous: boolean };

/** One row of the picker. `hidden` rows carry nothing but the code and the label. */
export type MineClip = {
  code: string;
  hidden: boolean;
  isAdult: boolean;
  anilistId?: number;
  episode?: number;
  start?: number;
  end?: number;
  title?: string | null;
  audio?: "sub" | "dub" | null;
  views?: number;
  createdAt?: string;
  animeTitle?: string | null;
};

export type MineResult = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

export const MINE_NO_STORE = { "cache-control": "no-store" } as const;

/** Newest first, deduplicated by id, capped at `limit`. */
export function mergeOwnerClips(accountClips: ClipRow[], guestClips: ClipRow[], limit = CLIP_MINE_LIMIT): ClipRow[] {
  const seen = new Set<string>();
  const merged: ClipRow[] = [];
  for (const row of [...accountClips, ...guestClips]) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  merged.sort((a, b) => {
    const left = Date.parse(a.created_at ?? "") || 0;
    const right = Date.parse(b.created_at ?? "") || 0;
    return right - left;
  });
  return merged.slice(0, Math.min(Math.max(limit, 1), CLIPS_PAGE_SIZE));
}

/**
 * The response rows, with the adult rule applied. Every field that would let a
 * viewer see an adult clip is dropped, not blanked - the browser cannot render
 * what it never received.
 */
export function toMineClips(
  rows: ClipRow[],
  anime: Map<number, AnimeSummary>,
  showAdult: boolean,
): MineClip[] {
  return rows.map((row) => {
    const summary = anime.get(Number(row.anilist_id)) ?? null;
    const isAdult = summary?.isAdult === true;
    if (isAdult && !showAdult) {
      return { code: row.code, hidden: true, isAdult: true };
    }
    return {
      code: row.code,
      hidden: false,
      isAdult,
      anilistId: Number(row.anilist_id),
      episode: Number(row.episode_number),
      start: Number(row.start_seconds),
      end: Number(row.end_seconds),
      title: row.title ?? null,
      audio: row.source_audio === "dub" ? "dub" : row.source_audio === "sub" ? "sub" : null,
      views: Number(row.views ?? 0),
      createdAt: row.created_at,
      animeTitle: summary?.title ?? null,
    };
  });
}

export async function handleClipsMine(deps: {
  session: MineSession | null;
  ownerHash: string | null;
  showAdult: boolean;
  ip: string;
  limiter: RateLimiter;
  listAccountClips: (userId: string, limit: number) => Promise<ClipRow[]>;
  listGuestClips: (ownerHash: string | null, limit: number) => Promise<ClipRow[]>;
  getAnime: (anilistIds: number[]) => Promise<Map<number, AnimeSummary>>;
  limit?: number;
}): Promise<MineResult> {
  const { session } = deps;

  if (!session?.userId) {
    return {
      status: 401,
      headers: MINE_NO_STORE,
      body: { error: "sign_in_required", message: "Sign in to see your clips." },
    };
  }
  if (session.isAnonymous) {
    return {
      status: 401,
      headers: MINE_NO_STORE,
      body: { error: "sign_in_required", message: "Sign in to see your clips." },
    };
  }

  const decision = deps.limiter.check(`${deps.ip}:${session.userId}`, CLIP_MINE_RATE);
  if (!decision.allowed) {
    return {
      status: 429,
      headers: { ...MINE_NO_STORE, "retry-after": String(decision.retryAfterSeconds) },
      body: { error: "rate_limited", message: "One moment. Try again in a few seconds." },
    };
  }

  const limit = deps.limit ?? CLIP_MINE_LIMIT;
  const [accountClips, guestClips] = await Promise.all([
    deps.listAccountClips(session.userId, limit),
    // A browser with no owner cookie simply has no guest clips; listClipsByOwnerHash
    // refuses a blank hash rather than matching every guest row.
    deps.listGuestClips(deps.ownerHash, limit),
  ]);

  const rows = mergeOwnerClips(accountClips, guestClips, limit);
  const anime = rows.length
    ? await deps.getAnime(rows.map((row) => Number(row.anilist_id)))
    : new Map<number, AnimeSummary>();

  return {
    status: 200,
    headers: MINE_NO_STORE,
    body: { clips: toMineClips(rows, anime, deps.showAdult === true) },
  };
}
