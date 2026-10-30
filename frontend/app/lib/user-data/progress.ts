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
// One warning per failure code per page load: a broken column would otherwise
// log on every 10s tick of every episode.
const warnedWriteCodes = new Set<string>();

/** Error code of a failed write, or "unknown" when the failure has none. */
export function writeFailureCode(failure: unknown): string {
  if (failure && typeof failure === "object" && typeof (failure as { code?: unknown }).code === "string") {
    return String((failure as { code: string }).code);
  }
  return "unknown";
}

/**
 * Logs a failed server write once per error code per page load and reports
 * whether it logged. A broken column would otherwise log on every 10s tick of
 * every episode.
 */
export function warnServerWriteFailureOnce(failure: unknown): boolean {
  const code = writeFailureCode(failure);
  if (warnedWriteCodes.has(code)) return false;
  warnedWriteCodes.add(code);
  try {
    console.warn(
      "[progress] server write failed",
      failure && typeof failure === "object"
        ? String((failure as { message?: unknown }).message ?? "")
        : String(failure),
      code,
    );
  } catch {
    /* console may be unavailable */
  }
  return true;
}

/** True once per episode, the first time playback reaches the keep-watching
 *  threshold, so a short visit still creates the entry. */
export function shouldMarkFirstSave(time: number, alreadySaved: boolean): boolean {
  return !alreadySaved && Number(time) >= CONTINUE_WATCHING_MIN_SECONDS;
}

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
      return;
    }

    // The row is not on the server yet, but it is not lost either: flushProgress
    // retries everything in `pending` on pause/hide/pagehide.
    pending.set(key, { id, record });
    warnServerWriteFailureOnce(result.error);
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

/**
 * Keep Watching cards need a real cover. Older rows (and rows saved without
 * AniList metadata) carry an empty snapshot cover, which rendered as a broken
 * image with just the alt text. The episode-images endpoint resolves, in order,
 * the episode thumbnail -> the anime cover -> the AniList cover, one batched
 * call for the whole list.
 */
export async function hydrateKeepWatchingImages(
  cards: KeepWatchingMediaData[],
): Promise<KeepWatchingMediaData[]> {
  if (!cards.length || typeof fetch !== "function") return cards;
  const needsArt = cards.filter(
    (card) => !card.coverImage?.extraLarge?.trim() || !card.episodeImg?.trim(),
  );
  if (!needsArt.length) return cards;

  try {
    const response = await fetch("/api/anime/episode-images", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: needsArt.map((card) => ({
          anilistId: card.id,
          episode: Number(card.episode) || 1,
        })),
      }),
    });
    if (!response.ok) return cards;
    const payload = await response.json();
    const images: Record<string, string | null> = payload?.images ?? {};

    return cards.map((card) => {
      const key = `${card.id}-${Number(card.episode) || 1}`;
      const found = images[key];
      if (!found) return card;
      const cover = card.coverImage?.extraLarge?.trim();
      return {
        ...card,
        episodeImg: card.episodeImg?.trim() || found,
        ...(cover ? {} : { coverImage: { extraLarge: found, large: found } }),
      } as KeepWatchingMediaData;
    });
  } catch {
    return cards;
  }
}

/** The card's best title, in the order the cards render it. */
function cardTitle(card: KeepWatchingMediaData): string {
  const title = card.title as Record<string, string | undefined> | undefined;
  return title?.userPreferred || title?.romaji || title?.english || "";
}

function cardCover(card: KeepWatchingMediaData): string {
  return card.coverImage?.extraLarge || card.coverImage?.large || "";
}

/**
 * Server rows and the local copy, one card per anime.
 *
 * A signed-in user writes to Supabase, but a write can fail (offline, a rejected
 * row, a paused tab): the local copy then holds the newer episode and the server
 * does not. Neither side alone is the truth, so the newest `updatedAt` wins and
 * the loser still fills in any art it has. A local-only anime keeps its card.
 */
export function mergeContinueWatchingLists(
  serverCards: KeepWatchingMediaData[],
  localCards: KeepWatchingMediaData[],
  limit = CONTINUE_WATCHING_LIMIT,
): KeepWatchingMediaData[] {
  const byAnime = new Map<string, KeepWatchingMediaData>();

  for (const card of [...serverCards, ...localCards]) {
    if (!card || card.id === undefined || card.id === null) continue;
    const key = String(card.id);
    const existing = byAnime.get(key);
    if (!existing) {
      byAnime.set(key, card);
      continue;
    }

    const winner = (card.updatedAt || 0) > (existing.updatedAt || 0) ? card : existing;
    const other = winner === card ? existing : card;
    const cover = cardCover(winner) || cardCover(other);

    byAnime.set(key, {
      ...winner,
      // metadata the winner may be missing: never drop art the other side has
      title: cardTitle(winner)
        ? winner.title
        : (other.title ?? winner.title),
      coverImage: cover
        ? { extraLarge: cover, large: cover }
        : (winner.coverImage ?? other.coverImage),
      episodeImg: winner.episodeImg?.trim() || other.episodeImg?.trim() || "",
    } as KeepWatchingMediaData);
  }

  return Array.from(byAnime.values())
    .filter((card) =>
      shouldResume(
        Number(card.episodeTimeLastStop) || 0,
        Number(card.episodeDuration) || 0,
      ),
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);
}

export async function listContinueWatchingFromServer(
  input?: UserDataContextInput,
): Promise<KeepWatchingMediaData[]> {
  const local = listContinueWatchingAsMediaData();
  const ctx = await resolveContext(input);
  // Guests and anonymous devices: the local copy is all there is.
  if (!isSignedIn(ctx)) return hydrateKeepWatchingImages(local);

  const result = await attempt("progress.continueWatching", async () => {
    const { data, error } = await ctx.client!.from("watch_progress")
      .select("anilist_id, episode_number, position_seconds, duration_seconds, audio, completed, snapshot, updated_at")
      .eq("user_id", ctx.userId)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as ServerProgressRow[];
  });

  if (!result.ok) return hydrateKeepWatchingImages(local);

  // Server rows win only where they are newer; the local list still covers the
  // writes the server never received.
  return hydrateKeepWatchingImages(
    mergeContinueWatchingLists(
      buildContinueWatchingMediaData(result.data),
      local,
    ),
  );
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
  warnedWriteCodes.clear();
}
