"use client";
// Watch progress. The player keeps its synchronous localStorage API (same exports,
// same signatures); signed-in users additionally sync to Supabase `watch_progress`.

import { attempt, getDefaultContext, isSignedIn, resolveContext, type UserDataContextInput } from "./context";
import { normaliseProgressSnapshot } from "./normalise";
import { displayTitle } from "@/app/lib/titles";
import type { ServerProgressRow } from "./types";
import type { KeepWatchingMediaData } from "@/app/ts/interfaces/firestoreData";

export type ProgressRecord = {
  episode: number;
  time: number;
  duration: number;
  audio: "sub" | "dub";
  updatedAt: number;
  title?: string;
  cover?: string;
  /** Episode thumbnail for Keep Watching (falls back to `cover`). */
  episodeImage?: string;
  watched: number[];
};

const KEY = "kumori_progress_v1";
const eventName = "kumori-progress-change";

export const SERVER_WRITE_INTERVAL_MS = 15_000;
export const COMPLETION_RATIO = 0.9;
export const CONTINUE_WATCHING_MIN_SECONDS = 5;
export const CONTINUE_WATCHING_LIMIT = 20;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(): Record<string, ProgressRecord> {
  try {
    return JSON.parse(storage()?.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function write(value: Record<string, ProgressRecord>) {
  try {
    const entries = Object.entries(value)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, 100);
    storage()?.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(eventName));
  } catch {
    /* storage full or unavailable: playback must continue */
  }
}

export function getProgress(id: number | string) {
  if (typeof window === "undefined") return null;
  return read()[String(id)] || null;
}

function writeLocal(id: number | string, patch: Partial<ProgressRecord>): ProgressRecord | null {
  if (typeof window === "undefined") return null;
  const all = read();
  const old =
    all[String(id)] ||
    ({ episode: 1, time: 0, duration: 0, audio: "sub", updatedAt: Date.now(), watched: [] } as ProgressRecord);
  const record: ProgressRecord = {
    ...old,
    ...patch,
    updatedAt: Date.now(),
    // keep an explicit `watched` from the patch (markWatched) instead of the old one
    watched: patch.watched ?? old.watched ?? [],
  };
  all[String(id)] = record;
  write(all);
  return record;
}

export function saveProgress(id: number | string, patch: Partial<ProgressRecord>) {
  const record = writeLocal(id, patch);
  if (!record) return;
  latest.set(String(id), record);
  installFlushListeners();
  void queueServerWrite(id, record);
}

export function markWatched(id: number | string, ep: number, value = true) {
  const old =
    getProgress(id) ||
    ({ episode: ep, time: 0, duration: 0, audio: "sub" as const, updatedAt: Date.now(), watched: [] } as ProgressRecord);
  const watched = new Set(old.watched || []);
  if (value) watched.add(ep);
  else watched.delete(ep);

  const record = writeLocal(id, { episode: ep, watched: [...watched].sort((a, b) => a - b) });
  if (!record) return;
  latest.set(String(id), record);
  installFlushListeners();
  // Marking an episode is an explicit action: write it through immediately.
  void writeServer(id, record, { immediate: true, completedOverride: value });
}

export function isWatched(id: number | string, ep: number) {
  return !!getProgress(id)?.watched?.includes(ep);
}

export function listContinueWatching(limit = CONTINUE_WATCHING_LIMIT) {
  return Object.entries(read())
    .filter(([, v]) => v.time >= CONTINUE_WATCHING_MIN_SECONDS && (!v.duration || v.time < v.duration - 10))
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, limit)
    .map(([id, progress]) => ({ id: Number(id), progress }));
}

export function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const fn = () => callback();
  window.addEventListener("storage", fn);
  window.addEventListener(eventName, fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener(eventName, fn);
  };
}

export function shouldResume(time: number, duration: number) {
  return time >= CONTINUE_WATCHING_MIN_SECONDS && (!duration || time < duration - 10);
}

export function isProgressCompleted(time: number, duration: number): boolean {
  if (!duration || duration <= 0) return false;
  return time >= duration * COMPLETION_RATIO;
}

// ---------------------------------------------------------------- server sync

const lastWriteAt = new Map<string, number>();
const latest = new Map<string, ProgressRecord>();
const pending = new Map<string, { id: number | string; record: ProgressRecord }>();
let listenersInstalled = false;
let hydration: Promise<number> | null = null;

function writeKey(id: number | string, record: ProgressRecord) {
  return `${id}:${record.episode}`;
}

function remember(id: number | string, record: ProgressRecord) {
  latest.set(String(id), record);
}

async function writeServer(
  id: number | string,
  record: ProgressRecord,
  options?: { immediate?: boolean; completedOverride?: boolean },
) {
  try {
    const ctx = await getDefaultContext();
    if (!isSignedIn(ctx)) return;

    const key = writeKey(id, record);
    const nowMs = ctx.now();
    const last = lastWriteAt.get(key) ?? 0;

    if (!options?.immediate && nowMs - last < SERVER_WRITE_INTERVAL_MS) {
      pending.set(key, { id, record });
      return;
    }

    const completed =
      options?.completedOverride ??
      (isProgressCompleted(record.time, record.duration) || (record.watched || []).includes(record.episode));

    const result = await attempt("progress.upsert", async () => {
      const { error } = await ctx.client!.from("watch_progress").upsert(
        {
          user_id: ctx.userId,
          anilist_id: Number(id),
          episode_number: Number(record.episode),
          position_seconds: Math.max(0, Math.round(record.time || 0)),
          duration_seconds: record.duration ? Math.round(record.duration) : null,
          audio: record.audio === "dub" ? "dub" : "sub",
          completed,
          snapshot: {
            title: record.title ?? null,
            cover: record.cover ?? null,
            episodeImage: record.episodeImage ?? null,
          },
          updated_at: new Date(nowMs).toISOString(),
        },
        { onConflict: "user_id,anilist_id,episode_number" },
      );
      if (error) throw error;
      return true;
    });

    if (result.ok) {
      lastWriteAt.set(key, nowMs);
      pending.delete(key);
    }
  } catch {
    /* best effort: never block playback, never throw */
  }
}

async function queueServerWrite(id: number | string, record: ProgressRecord) {
  remember(id, record);
  await writeServer(id, record);
}

function installFlushListeners() {
  if (listenersInstalled) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  listenersInstalled = true;
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushProgress();
    });
    window.addEventListener("pagehide", () => void flushProgress());
    // "pause" does not bubble, so listen in the capture phase: this catches the
    // player pausing without the player files having to know about the sync.
    document.addEventListener("pause", () => void flushProgress(), true);
  } catch {
    /* listeners are a nicety */
  }
}

/** Sends the newest local state for every anime whose last server write is stale.
 *  Called on pause, on hidden tabs and on pagehide. */
export async function flushProgress(): Promise<void> {
  const stale: { id: number | string; record: ProgressRecord }[] = [];
  for (const [key, record] of latest.entries()) {
    const last = lastWriteAt.get(writeKey(key, record)) ?? 0;
    if (record.updatedAt > last) stale.push({ id: key, record });
  }
  for (const item of pending.values()) {
    if (!stale.some((entry) => writeKey(entry.id, entry.record) === writeKey(item.id, item.record))) {
      stale.push(item);
    }
  }
  pending.clear();
  if (!stale.length) return;

  for (const item of stale) {
    await writeServer(item.id, item.record, { immediate: true });
  }
}

/** Pulls the newest server rows into the local cache so resume works on open. */
export async function syncProgressFromServer(input?: UserDataContextInput): Promise<number> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return 0;

  const result = await attempt("progress.sync", async () => {
    const { data, error } = await ctx.client!.from("watch_progress")
      .select("anilist_id, episode_number, position_seconds, duration_seconds, audio, completed, snapshot, updated_at")
      .eq("user_id", ctx.userId)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as ServerProgressRow[];
  });

  if (!result.ok) return 0;
  return mergeServerRowsIntoLocal(result.data);
}

/** Newest record wins, watched episodes are unioned. Never throws. */
export function mergeServerRowsIntoLocal(rows: ServerProgressRow[]): number {
  if (typeof window === "undefined" || !rows?.length) return 0;

  const all = read();
  let changed = 0;

  for (const row of rows) {
    if (!row || !Number.isFinite(Number(row.anilist_id))) continue;
    const key = String(row.anilist_id);
    const rowUpdatedAt = Date.parse(row.updated_at) || 0;
    const snapshot = normaliseProgressSnapshot(row.snapshot);
    // English-first, so continue-watching cards never fall back to romaji for rows
    // whose snapshot predates the display rule.
    const snapshotTitle = snapshot.title ? displayTitle(snapshot.title) : undefined;
    const existing = all[key];
    const watched = new Set(existing?.watched ?? []);
    if (row.completed) watched.add(Number(row.episode_number));

    const serverNewer = !existing || rowUpdatedAt > existing.updatedAt;

    if (!serverNewer && !row.completed) continue;

    all[key] = {
      episode: serverNewer ? Number(row.episode_number) : existing!.episode,
      time: serverNewer ? Number(row.position_seconds) || 0 : existing!.time,
      duration: serverNewer ? Number(row.duration_seconds) || 0 : existing!.duration,
      audio: serverNewer ? (row.audio === "dub" ? "dub" : "sub") : existing!.audio,
      updatedAt: serverNewer ? rowUpdatedAt : existing!.updatedAt,
      title: existing?.title || snapshotTitle,
      cover: existing?.cover || snapshot.cover || undefined,
      episodeImage:
        existing?.episodeImage || snapshot.episodeImage || undefined,
      watched: Array.from(watched).sort((a, b) => a - b),
    };
    changed++;
  }

  if (changed) write(all);
  return changed;
}

/** Runs once per page load, so a fresh device has resume data before play starts. */
export function hydrateProgress(input?: UserDataContextInput): Promise<number> {
  hydration ??= syncProgressFromServer(input).catch(() => 0);
  return hydration;
}

export function buildContinueWatchingMediaData(rows: ServerProgressRow[]): KeepWatchingMediaData[] {
  const newestPerAnime = new Map<number, ServerProgressRow>();

  for (const row of [...(rows || [])].sort(
    (a, b) => (Date.parse(b?.updated_at) || 0) - (Date.parse(a?.updated_at) || 0),
  )) {
    if (!row || !Number.isFinite(Number(row.anilist_id))) continue;
    const id = Number(row.anilist_id);
    if (!newestPerAnime.has(id)) newestPerAnime.set(id, row);
  }

  return Array.from(newestPerAnime.values())
    .filter(
      (row) =>
        !row.completed &&
        Number(row.position_seconds) >= CONTINUE_WATCHING_MIN_SECONDS,
    )
    .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0))
    .slice(0, CONTINUE_WATCHING_LIMIT)
    .map((row) => toKeepWatchingMediaData(row));
}

export function toKeepWatchingMediaData(row: ServerProgressRow): KeepWatchingMediaData {
  const snapshot = normaliseProgressSnapshot(row.snapshot);
  const title =
    typeof snapshot.title === "string"
      ? { romaji: snapshot.title, userPreferred: displayTitle(snapshot.title) }
      : snapshot.title || { romaji: "" };
  const cover = snapshot.cover || "";
  const updatedAt = Date.parse(row.updated_at) || Date.now();

  return {
    id: Number(row.anilist_id),
    title: { ...title, userPreferred: displayTitle(title) },
    description: "",
    updatedAt,
    // legacy fields the original KeepWatching cards expect
    source: "gogoanime",
    format: "TV",
    type: "TV",
    episodes: 0,
    episode: `${row.episode_number}`,
    episodeId: "",
    // the episode thumbnail first; the anime cover is the fallback the card uses
    episodeImg: snapshot.episodeImage || cover,
    episodeTimeLastStop: Number(row.position_seconds) || 0,
    episodeDuration: Number(row.duration_seconds) || 0,
    dub: row.audio === "dub",
    coverImage: { extraLarge: cover, large: cover },
    isFavourite: false,
    mediaListEntry: null,
  } as KeepWatchingMediaData;
}

/** Local (guest) continue-watching list, mapped to the same card data. */
export function listContinueWatchingAsMediaData(limit = CONTINUE_WATCHING_LIMIT): KeepWatchingMediaData[] {
  return listContinueWatching(limit).map((item) => {
    const record = item.progress;
    const title = record.title || "";
    const cover = record.cover || "";
    return {
      id: item.id,
      title: { romaji: title, userPreferred: displayTitle(title) },
      description: "",
      updatedAt: record.updatedAt,
      source: "gogoanime",
      format: "TV",
      type: "TV",
      episodes: 0,
      episode: `${record.episode}`,
      episodeId: "",
      episodeImg: record.episodeImage || cover,
      episodeTimeLastStop: record.time,
      episodeDuration: record.duration,
      dub: record.audio === "dub",
      coverImage: { extraLarge: cover, large: cover },
      isFavourite: false,
      mediaListEntry: null,
    } as KeepWatchingMediaData;
  });
}

export async function listContinueWatchingFromServer(
  input?: UserDataContextInput,
): Promise<KeepWatchingMediaData[]> {
  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return listContinueWatchingAsMediaData();

  const result = await attempt("progress.continueWatching", async () => {
    const { data, error } = await ctx.client!.from("watch_progress")
      .select("anilist_id, episode_number, position_seconds, duration_seconds, audio, completed, snapshot, updated_at")
      .eq("user_id", ctx.userId)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as ServerProgressRow[];
  });

  if (!result.ok) return listContinueWatchingAsMediaData();
  return buildContinueWatchingMediaData(result.data);
}

/** Removing a card deletes that anime's incomplete rows. */
export async function deleteContinueWatching(
  anilistId: number | string,
  input?: UserDataContextInput,
): Promise<boolean> {
  const all = read();
  if (all[String(anilistId)]) {
    delete all[String(anilistId)];
    write(all);
  }
  latest.delete(String(anilistId));

  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return true;

  const result = await attempt("progress.deleteIncomplete", async () => {
    const { error } = await ctx.client!.from("watch_progress")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("anilist_id", Number(anilistId))
      .eq("completed", false);
    if (error) throw error;
    return true;
  });

  return result.ok;
}

export async function clearProgress(input?: UserDataContextInput): Promise<boolean> {
  try {
    storage()?.removeItem(KEY);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(eventName));
  } catch {
    /* ignore */
  }
  latest.clear();
  pending.clear();
  lastWriteAt.clear();

  const ctx = await resolveContext(input);
  if (!isSignedIn(ctx)) return true;

  const result = await attempt("progress.clear", async () => {
    const { error } = await ctx.client!.from("watch_progress").delete().eq("user_id", ctx.userId);
    if (error) throw error;
    return true;
  });
  return result.ok;
}

export function __resetProgressSyncForTests() {
  lastWriteAt.clear();
  latest.clear();
  pending.clear();
  hydration = null;
  listenersInstalled = false;
}
