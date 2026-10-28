"use client";
// One-time (per user, per device) merge of guest data into the new Supabase rows.

import { attempt, isSignedIn, resolveContext, type StorageLike, type UserDataContextInput } from "./context";
import { GUEST_CHAPTERS_KEY, LEGACY_GUEST_CHAPTERS_KEY } from "./chapters";
import { GUEST_FAVOURITES_KEY } from "./favourites";
import { GUEST_LISTS_KEY, toDbStatus } from "./lists";
import { normaliseSnapshotList } from "./normalise";
import { readFlag, readJson, removeKey, writeFlag, writeJson } from "./storage";
import { clearSessionCache } from "./context";
import { __resetProgressSyncForTests } from "./progress";
import type { ListEntry, UserPrefs } from "./types";

export const MERGE_MARKER_PREFIX = "kumori_merged_";
export const GUEST_PROGRESS_KEY = "kumori_progress_v1";

export function mergeMarkerKey(userId: string): string {
  return `${MERGE_MARKER_PREFIX}${userId}`;
}

type GuestProgress = Record<
  string,
  {
    episode: number;
    time: number;
    duration: number;
    audio: "sub" | "dub";
    updatedAt: number;
    watched?: number[];
    title?: string;
    cover?: string;
  }
>;

export type MergeResult = {
  merged: boolean;
  reason: string;
  favourites: number;
  lists: number;
  progress: number;
  chapters: number;
  prefs: boolean;
};

function guestPrefs(storage: StorageLike | null): UserPrefs {
  const read = (key: string) => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const bool = (key: string, fallback: boolean) => {
    const value = read(key);
    if (value === null) return fallback;
    return value === "true";
  };
  return {
    autoSkip: bool("autoSkip", false),
    autoNext: bool("autoNext", true),
    dubEpisodes: bool("dubEpisodes", false),
    subtitle_language: read("subtitle_language") || "English",
  };
}

/**
 * Uploads guest favourites, lists, progress and (untouched) preferences.
 * Never throws: a failure leaves the marker unset so the next sign-in retries.
 */
export async function mergeGuestDataIntoAccount(
  userId: string,
  input?: UserDataContextInput,
): Promise<MergeResult> {
  const result: MergeResult = { merged: false, reason: "", favourites: 0, lists: 0, progress: 0, chapters: 0, prefs: false };

  try {
    const ctx = await resolveContext({ ...(input ?? {}), userId });

    if (!isSignedIn(ctx)) {
      result.reason = "not-signed-in";
      return result;
    }

    if (readFlag(ctx.storage, mergeMarkerKey(userId))) {
      result.reason = "already-merged";
      return result;
    }

    const guestFavourites = normaliseSnapshotList(readJson<unknown[]>(ctx.storage, GUEST_FAVOURITES_KEY, []));
    const guestLists = Object.values(
      readJson<Record<string, ListEntry>>(ctx.storage, GUEST_LISTS_KEY, {}),
    ).filter((entry) => entry && Number.isFinite(Number(entry.id)));
    const guestProgress = readJson<GuestProgress>(ctx.storage, GUEST_PROGRESS_KEY, {});
    const prefs = guestPrefs(ctx.storage);

    // --- favourites (ignore duplicates)
    if (guestFavourites.length) {
      const loaded = await attempt("merge.favourites", async () => {
        const { data, error } = await ctx.client!.from("favourites")
          .select("anilist_id")
          .eq("user_id", userId);
        if (error) throw error;
        return (data ?? []) as { anilist_id: number }[];
      });
      if (!loaded.ok) throw loaded.error;

      const existing = new Set(loaded.data.map((row) => Number(row.anilist_id)));
      const rows = guestFavourites
        .filter((item) => !existing.has(Number(item.id)))
        .map((item) => ({ user_id: userId, anilist_id: item.id, snapshot: item }));

      if (rows.length) {
        const { error } = await ctx.client!.from("favourites").upsert(rows, { onConflict: "user_id,anilist_id" });
        if (error) throw error;
        result.favourites = rows.length;
      }
    }

    // --- lists (newer updated_at wins)
    if (guestLists.length) {
      const loaded = await attempt("merge.lists", async () => {
        const { data, error } = await ctx.client!.from("watchlist")
          .select("anilist_id, updated_at")
          .eq("user_id", userId);
        if (error) throw error;
        return (data ?? []) as { anilist_id: number; updated_at: string }[];
      });
      if (!loaded.ok) throw loaded.error;

      const serverUpdatedAt = new Map(
        loaded.data.map((row) => [Number(row.anilist_id), Date.parse(row.updated_at) || 0]),
      );

      const rows = guestLists
        .filter((entry) => (entry.updatedAt || 0) > (serverUpdatedAt.get(Number(entry.id)) ?? -1))
        .map((entry) => ({
          user_id: userId,
          anilist_id: Number(entry.id),
          status: toDbStatus(entry.status),
          progress: Number(entry.progress) || 0,
          snapshot: entry.snapshot,
          updated_at: new Date(entry.updatedAt || Date.now()).toISOString(),
        }));

      if (rows.length) {
        const { error } = await ctx.client!.from("watchlist").upsert(rows, { onConflict: "user_id,anilist_id" });
        if (error) throw error;
        result.lists = rows.length;
      }
    }

    // --- chapters read (union, newest read_at wins)
    const guestChapters = readJson<Record<string, Record<string, { anilistId?: number; chapterNumber?: number; chapterId?: string | null; lastPage?: number | null; snapshot?: unknown; readAt?: number }>>>(
      ctx.storage,
      GUEST_CHAPTERS_KEY,
      {},
    );
    const guestChapterRows = Object.entries(guestChapters ?? {}).flatMap(([mediaId, chapters]) =>
      Object.entries(chapters ?? {}).map(([chapterNumber, record]) => ({
        anilistId: Number(record?.anilistId ?? mediaId),
        chapterNumber: Number(record?.chapterNumber ?? chapterNumber),
        chapterId: record?.chapterId ?? null,
        lastPage: record?.lastPage ?? null,
        snapshot: record?.snapshot ?? null,
        readAt: Number(record?.readAt) || Date.now(),
      })),
    ).filter((row) => Number.isFinite(row.anilistId) && Number.isFinite(row.chapterNumber));

    if (guestChapterRows.length) {
      const loaded = await attempt("merge.chapters", async () => {
        const { data, error } = await ctx.client!.from("chapters_read")
          .select("anilist_id, chapter_number, read_at")
          .eq("user_id", userId);
        if (error) throw error;
        return (data ?? []) as { anilist_id: number; chapter_number: number; read_at: string }[];
      });
      if (!loaded.ok) throw loaded.error;

      const serverReadAt = new Map(
        loaded.data.map((row) => [`${Number(row.anilist_id)}:${Number(row.chapter_number)}`, Date.parse(row.read_at) || 0]),
      );

      const rows = guestChapterRows
        .filter((row) => row.readAt > (serverReadAt.get(`${row.anilistId}:${row.chapterNumber}`) ?? -1))
        .map((row) => ({
          user_id: userId,
          anilist_id: row.anilistId,
          chapter_number: row.chapterNumber,
          chapter_id: row.chapterId,
          last_page: row.lastPage,
          snapshot: row.snapshot,
          read_at: new Date(row.readAt).toISOString(),
        }));

      if (rows.length) {
        const { error } = await ctx.client!.from("chapters_read").upsert(rows, {
          onConflict: "user_id,anilist_id,chapter_number",
        });
        if (error) throw error;
        result.chapters = rows.length;
      }
    }

    // --- progress (newer updated_at wins, watched episodes are unioned)
    const progressKeys = Object.keys(guestProgress || {});
    if (progressKeys.length) {
      const loaded = await attempt("merge.progress", async () => {
        const { data, error } = await ctx.client!.from("watch_progress")
          .select("anilist_id, episode_number, updated_at, completed")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(500);
        if (error) throw error;
        return (data ?? []) as { anilist_id: number; episode_number: number; updated_at: string; completed: boolean }[];
      });
      if (!loaded.ok) throw loaded.error;

      const serverLatest = new Map<number, number>();
      const serverCompleted = new Set<string>();
      for (const row of loaded.data) {
        const id = Number(row.anilist_id);
        const updated = Date.parse(row.updated_at) || 0;
        serverLatest.set(id, Math.max(serverLatest.get(id) ?? 0, updated));
        if (row.completed) serverCompleted.add(`${id}:${row.episode_number}`);
      }

      const rows: Record<string, unknown>[] = [];
      for (const key of progressKeys) {
        const local = guestProgress[key];
        const id = Number(key);
        if (!local || !Number.isFinite(id) || !local.episode) continue;

        const localUpdated = Number(local.updatedAt) || 0;
        if (localUpdated > (serverLatest.get(id) ?? -1)) {
          rows.push({
            user_id: userId,
            anilist_id: id,
            episode_number: Number(local.episode),
            position_seconds: Math.max(0, Math.round(Number(local.time) || 0)),
            duration_seconds: local.duration ? Math.round(Number(local.duration)) : null,
            audio: local.audio === "dub" ? "dub" : "sub",
            completed:
              (Number(local.duration) > 0 && Number(local.time) >= Number(local.duration) * 0.9) ||
              (local.watched ?? []).includes(Number(local.episode)),
            snapshot: { title: local.title ?? null, cover: local.cover ?? null },
            updated_at: new Date(localUpdated || Date.now()).toISOString(),
          });
        }

        for (const episode of local.watched ?? []) {
          const episodeKey = `${id}:${episode}`;
          if (serverCompleted.has(episodeKey)) continue;
          // A watched episode is a completed row: union it, never lose it.
          rows.push({
            user_id: userId,
            anilist_id: id,
            episode_number: Number(episode),
            position_seconds: local.episode === episode ? Math.round(Number(local.time) || 0) : 0,
            duration_seconds: local.duration ? Math.round(Number(local.duration)) : null,
            audio: local.audio === "dub" ? "dub" : "sub",
            completed: true,
            snapshot: { title: local.title ?? null, cover: local.cover ?? null },
            updated_at: new Date(localUpdated || Date.now()).toISOString(),
          });
        }
      }

      if (rows.length) {
        const { error } = await ctx.client!.from("watch_progress").upsert(rows, {
          onConflict: "user_id,anilist_id,episode_number",
        });
        if (error) throw error;
        result.progress = rows.length;
      }
    }

    // --- preferences, only when the profile was never edited
    const profile = await attempt("merge.profile", async () => {
      const { data, error } = await ctx.client!.from("profiles")
        .select("created_at, updated_at")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data as { created_at: string; updated_at: string } | null;
    });

    if (profile.ok && profile.data && profile.data.updated_at === profile.data.created_at) {
      const patch = {
        auto_skip: prefs.autoSkip,
        auto_next: prefs.autoNext,
        preferred_audio: prefs.dubEpisodes ? "dub" : "sub",
        subtitle_language: prefs.subtitle_language,
        updated_at: new Date().toISOString(),
      };
      const { error } = await ctx.client!.from("profiles").update(patch).eq("id", userId);
      if (error) throw error;
      result.prefs = true;
    }

    // Success: the guest favourites/lists keys are no longer needed on this device.
    removeKey(ctx.storage, GUEST_FAVOURITES_KEY);
    removeKey(ctx.storage, GUEST_LISTS_KEY);
    removeKey(ctx.storage, GUEST_CHAPTERS_KEY);
    removeKey(ctx.storage, LEGACY_GUEST_CHAPTERS_KEY);
    writeFlag(ctx.storage, mergeMarkerKey(userId), true);

    result.merged = true;
    result.reason = "merged";
    return result;
  } catch (error) {
    // Keep everything local so the next sign-in retries.
    try {
      console.warn(
        "[user-data] mergeGuestDataIntoAccount failed, will retry next sign-in",
        error instanceof Error ? error.message : error,
      );
    } catch {
      /* ignore */
    }
    result.merged = false;
    result.reason = "error";
    return result;
  }
}

/** Local (device) caches that belong to a signed-in user. */
const USER_SCOPED_PREFIXES = ["kumori_favourites_cache_", "kumori_lists_cache_", "kumori_prefs_cache_"];

export function clearUserScopedCaches(userId?: string, input?: UserDataContextInput): void {
  const storage = input?.storage ?? (typeof window === "undefined" ? null : window.localStorage);
  const keys = ["notifications", "notificationsLastUpdate", "notificationsVisualized", GUEST_PROGRESS_KEY];

  if (storage) {
    for (const key of keys) removeKey(storage, key);
    try {
      const all = Object.keys((storage as unknown as { dump?: () => Record<string, string> }).dump?.() ?? {});
      for (const key of [...all, ...Object.keys(localStorageSnapshotKeys(storage))]) {
        if (USER_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix))) removeKey(storage, key);
        if (userId && key === mergeMarkerKey(userId)) removeKey(storage, key);
      }
    } catch {
      /* ignore */
    }
  }

  // Reset progress caches held in memory so the next guest starts clean.
  writeJson(storage, "kumori_progress_v1", {});
  __resetProgressSyncForTests();
  clearSessionCache();
}

function localStorageSnapshotKeys(storage: StorageLike): Record<string, string> {
  const keys: Record<string, string> = {};
  try {
    const length = (storage as unknown as { length?: number }).length ?? 0;
    for (let index = 0; index < length; index += 1) {
      const key = (storage as unknown as { key?: (index: number) => string | null }).key?.(index);
      if (key) keys[key] = key;
    }
  } catch {
    /* ignore */
  }
  return keys;
}

/** Resets the "already merged" marker (owner asked to re-run the merge). */
export function clearMergeMarker(userId: string, input?: UserDataContextInput): void {
  const storage = input?.storage ?? (typeof window === "undefined" ? null : window.localStorage);
  removeKey(storage, mergeMarkerKey(userId));
}
