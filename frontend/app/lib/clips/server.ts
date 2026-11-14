// Prompt 35: clip persistence (server only).
//
// Every read and write goes through the service-role client on the server, the
// same way the rest of the repo reads Supabase from route handlers and pages.
// RLS on `public.clips` therefore blocks direct anon/authenticated access; the
// API routes are the only way in, and they decide who may do what.

import "server-only";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { CLIP_CODE_ATTEMPTS, CLIPS_PAGE_SIZE } from "./constants";
import { generateClipCode, generateUniqueClipCode } from "./code";
import { hashOwnerToken, ownerTokenSecret } from "./owner-token";

export type ClipRow = {
  id: string;
  code: string;
  anilist_id: number;
  episode_number: number;
  start_seconds: number;
  end_seconds: number;
  title: string | null;
  user_id: string | null;
  owner_token_hash: string | null;
  source_audio: "sub" | "dub" | null;
  views: number;
  created_at: string;
  deleted_at: string | null;
};

export type PublicClip = {
  code: string;
  anilistId: number;
  episode: number;
  start: number;
  end: number;
  title: string | null;
  audio: "sub" | "dub" | null;
  views: number;
  createdAt: string;
};

export type AnimeSummary = {
  anilistId: number;
  title: string | null;
  cover: string | null;
  banner: string | null;
  isAdult: boolean;
};

const SELECT =
  "id,code,anilist_id,episode_number,start_seconds,end_seconds,title,user_id,owner_token_hash,source_audio,views,created_at,deleted_at";

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function toPublicClip(row: ClipRow): PublicClip {
  return {
    code: row.code,
    anilistId: num(row.anilist_id),
    episode: num(row.episode_number),
    start: num(row.start_seconds),
    end: num(row.end_seconds),
    title: typeof row.title === "string" && row.title.trim() ? row.title : null,
    audio: row.source_audio === "dub" ? "dub" : row.source_audio === "sub" ? "sub" : null,
    views: num(row.views),
    createdAt: row.created_at,
  };
}

function db(): any | null {
  return createAdminClient();
}

/** One live clip by code, or null (missing, deleted, or database down). */
export async function getClipByCode(code: string): Promise<ClipRow | null> {
  const client = db();
  if (!client || typeof code !== "string" || !code) return null;
  try {
    const { data } = await client
      .from("clips")
      .select(SELECT)
      .eq("code", code)
      .is("deleted_at", null)
      .maybeSingle();
    return (data as ClipRow | null) ?? null;
  } catch {
    return null;
  }
}

/** The `anime` row is the cheap, offline-safe source for the clip page. */
export async function getAnimeSummary(anilistId: number): Promise<AnimeSummary | null> {
  const client = db();
  if (!client) return null;
  try {
    const { data } = await client
      .from("anime")
      .select("anilist_id,title,title_english,title_romaji,cover_url,banner_url,is_adult")
      .eq("anilist_id", anilistId)
      .maybeSingle();
    if (!data) return null;
    const row: any = data;
    return {
      anilistId: num(row.anilist_id),
      title: row.title_english || row.title || row.title_romaji || null,
      cover: row.cover_url || null,
      banner: row.banner_url || null,
      isAdult: row.is_adult === true,
    };
  } catch {
    return null;
  }
}

/** One query for a whole list page (avoids a lookup per clip). */
export async function getAnimeSummaries(
  anilistIds: number[],
): Promise<Map<number, AnimeSummary>> {
  const map = new Map<number, AnimeSummary>();
  const client = db();
  const ids = [...new Set(anilistIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!client || ids.length === 0) return map;
  try {
    const { data } = await client
      .from("anime")
      .select("anilist_id,title,title_english,title_romaji,cover_url,banner_url,is_adult")
      .in("anilist_id", ids);
    for (const row of (data as any[] | null) ?? []) {
      map.set(num(row.anilist_id), {
        anilistId: num(row.anilist_id),
        title: row.title_english || row.title || row.title_romaji || null,
        cover: row.cover_url || null,
        banner: row.banner_url || null,
        isAdult: row.is_adult === true,
      });
    }
  } catch {
    /* the list still renders without names */
  }
  return map;
}

export type CreateClipRecordInput = {
  anilistId: number;
  episode: number;
  start: number;
  end: number;
  title: string | null;
  audio: "sub" | "dub" | null;
  userId: string | null;
  ownerToken: string | null;
};

/**
 * Inserts a clip with a collision-checked code. `clips.anilist_id` references
 * `anime`, so an unknown anime is refused here with `unknown_anime` rather than
 * surfacing a foreign-key error.
 */
export async function createClipRecord(
  input: CreateClipRecordInput,
): Promise<{ ok: true; clip: ClipRow } | { ok: false; error: string }> {
  const client = db();
  if (!client) return { ok: false, error: "database_unavailable" };

  const anime = await getAnimeSummary(input.anilistId);
  if (!anime) return { ok: false, error: "unknown_anime" };

  const ownerHash = input.ownerToken
    ? hashOwnerToken(input.ownerToken, ownerTokenSecret())
    : null;
  if (input.ownerToken && !ownerHash) return { ok: false, error: "invalid_owner_token" };

  const exists = async (candidate: string) => {
    const { data } = await client
      .from("clips")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    return Boolean(data);
  };

  for (let attempt = 0; attempt < Math.min(3, CLIP_CODE_ATTEMPTS); attempt += 1) {
    const code =
      attempt === 0
        ? await generateUniqueClipCode(exists)
        : (await exists(generateClipCode())) ? null : generateClipCode();
    if (!code) continue;

    const { data, error } = await client
      .from("clips")
      .insert({
        code,
        anilist_id: input.anilistId,
        episode_number: input.episode,
        start_seconds: input.start,
        end_seconds: input.end,
        title: input.title,
        user_id: input.userId,
        owner_token_hash: input.userId ? null : ownerHash,
        source_audio: input.audio,
      })
      .select(SELECT)
      .single();

    if (!error && data) return { ok: true, clip: data as ClipRow };
    // 23505 = unique violation: another request took the code, try again.
    if (error && String(error.code) !== "23505") {
      return { ok: false, error: "insert_failed" };
    }
  }
  return { ok: false, error: "code_unavailable" };
}

export type OwnerCheck = { userId: string | null; ownerToken: string | null };

export type ClipMutation = "ok" | "not_found" | "forbidden" | "unavailable";

/** Whether this caller may rename/delete the clip (used by GET and the routes). */
export function canManageClip(row: ClipRow, owner: OwnerCheck): boolean {
  return ownsClip(row, owner);
}

function ownsClip(row: ClipRow, { userId, ownerToken }: OwnerCheck): boolean {
  if (userId && row.user_id && row.user_id === userId) return true;
  if (!userId || !row.user_id) {
    // A guest cookie may only ever touch a guest's clip.
    return Boolean(
      !row.user_id &&
        ownerToken &&
        hashOwnerToken(ownerToken, ownerTokenSecret()) === row.owner_token_hash,
    );
  }
  return false;
}

/** Soft delete: the row stays for the report/moderation trail. */
export async function deleteClip(code: string, owner: OwnerCheck): Promise<ClipMutation> {
  const client = db();
  if (!client) return "unavailable";
  const row = await getClipByCode(code);
  if (!row) return "not_found";
  if (!ownsClip(row, owner)) return "forbidden";

  const { error } = await client
    .from("clips")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("deleted_at", null);
  return error ? "unavailable" : "ok";
}

/** Rename, same ownership rules as delete. */
export async function renameClip(
  code: string,
  title: string | null,
  owner: OwnerCheck,
): Promise<{ result: ClipMutation; clip?: ClipRow }> {
  const client = db();
  if (!client) return { result: "unavailable" };
  const row = await getClipByCode(code);
  if (!row) return { result: "not_found" };
  if (!ownsClip(row, owner)) return { result: "forbidden" };

  const { data, error } = await client
    .from("clips")
    .update({ title })
    .eq("id", row.id)
    .select(SELECT)
    .single();
  if (error || !data) return { result: "unavailable" };
  return { result: "ok", clip: data as ClipRow };
}

/** Atomic increment through the SQL function (see docs/sql/clips.sql). */
export async function incrementClipViews(code: string): Promise<number | null> {
  const client = db();
  if (!client) return null;
  try {
    const { data, error } = await client.rpc("increment_clip_views", { p_code: code });
    if (error) return null;
    const value = Array.isArray(data) ? data[0] : data;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

export async function reportClip({
  clipId,
  reason,
  details,
  reporterHash,
}: {
  clipId: string;
  reason: string;
  details: string | null;
  reporterHash: string | null;
}): Promise<boolean> {
  const client = db();
  if (!client) return false;
  const { error } = await client.from("clip_reports").insert({
    clip_id: clipId,
    reason,
    details,
    reporter_hash: reporterHash,
  });
  return !error;
}

/** `/clips` - newest first, live rows only. */
export async function listUserClips(userId: string, limit = CLIPS_PAGE_SIZE): Promise<ClipRow[]> {
  const client = db();
  if (!client || !userId) return [];
  try {
    const { data } = await client
      .from("clips")
      .select(SELECT)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), CLIPS_PAGE_SIZE));
    return (data as ClipRow[] | null) ?? [];
  } catch {
    return [];
  }
}

/**
 * Prompt 38F: the clips this BROWSER made before it had an account.
 *
 * A guest clip has `user_id is null` and an `owner_token_hash` derived from the
 * first-party cookie. Handing those to the account that signs in on the same
 * browser is the whole point of the clip picker: "make one from any episode"
 * should not require signing in first.
 *
 * The filter is deliberately narrow, and all three parts matter:
 *   * `user_id is null` - a clip that belongs to an account is NEVER matched by
 *     a cookie hash, so signing in on someone else's browser cannot surface
 *     their clips;
 *   * the hash is compared, never the token, and only the hash is stored;
 *   * a null/blank hash returns nothing at all, so a caller with no cookie
 *     (or a malformed one) gets an empty list rather than a wildcard match.
 */
export async function listClipsByOwnerHash(
  ownerHash: string | null,
  limit = 20,
): Promise<ClipRow[]> {
  const client = db();
  const hash = typeof ownerHash === "string" ? ownerHash.trim() : "";
  if (!client || hash.length < 32) return [];
  try {
    const { data } = await client
      .from("clips")
      .select(SELECT)
      .eq("owner_token_hash", hash)
      .is("user_id", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), CLIPS_PAGE_SIZE));
    return (data as ClipRow[] | null) ?? [];
  } catch {
    return [];
  }
}
