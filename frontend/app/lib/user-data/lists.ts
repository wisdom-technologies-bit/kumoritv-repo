"use client";
// Lists / watchlist: localStorage for guests, Supabase `watchlist` for signed-in users.

import { attempt, isSignedIn, resolveContext, type UserDataContextInput } from "./context";
import { normaliseSnapshot } from "./normalise";
import { readJson, writeJson } from "./storage";
import type {
  AnilistListStatus,
  FavouriteSnapshot,
  ListEntry,
  ListStatus,
} from "./types";

export const GUEST_LISTS_KEY = "kumori_lists_v1";

const ANILIST_TO_DB: Record<AnilistListStatus, ListStatus> = {
  CURRENT: "watching",
  PLANNING: "planning",
  COMPLETED: "completed",
  DROPPED: "dropped",
  PAUSED: "paused",
  REPEATING: "repeating",
};

const DB_TO_ANILIST: Record<ListStatus, AnilistListStatus> = {
  watching: "CURRENT",
  planning: "PLANNING",
  completed: "COMPLETED",
  dropped: "DROPPED",
  paused: "PAUSED",
  repeating: "REPEATING",
};

export const LIST_STATUSES: ListStatus[] = [
  "watching",
  "planning",
  "completed",
  "dropped",
  "paused",
  "repeating",
];

/** AniList status (CURRENT) -> table status (watching). Accepts either casing. */
export function toDbStatus(status: string): ListStatus {
  const upper = status.toUpperCase() as AnilistListStatus;
  if (ANILIST_TO_DB[upper]) return ANILIST_TO_DB[upper];
  return status.toLowerCase() as ListStatus;
}

/** Table status (watching) -> AniList status (CURRENT). */
export function toAnilistStatus(status: string): AnilistListStatus {
  const lower = status.toLowerCase() as ListStatus;
  return DB_TO_ANILIST[lower] ?? (status.toUpperCase() as AnilistListStatus);
}

export function listsCacheKey(userId: string): string {
  return `kumori_lists_cache_${userId}`;
}

type EntryMap = Record<string, ListEntry>;

function localKey(ctx: { userId: string | null; client: unknown }): string {
  return ctx.userId && ctx.client ? listsCacheKey(ctx.userId) : GUEST_LISTS_KEY;
}

export function readEntries(storage: UserDataContextInput["storage"], key: string): ListEntry[] {
  const map = readJson<EntryMap>(storage ?? null, key, {});
  return Object.values(map).filter((entry) => entry && Number.isFinite(Number(entry.id)));
}

function writeEntries(storage: UserDataContextInput["storage"], key: string, entries: ListEntry[]): void {
  const map: EntryMap = {};
  for (const entry of entries) map[String(entry.id)] = entry;
  writeJson(storage ?? null, key, map);
}

export async function listEntries(input?: UserDataContextInput): Promise<ListEntry[]> {
  const ctx = await resolveContext(input);
  const key = localKey(ctx);

  if (!isSignedIn(ctx)) return readEntries(ctx.storage, key);

  const result = await attempt("lists.list", async () => {
    const { data, error } = await ctx.client!.from("watchlist")
      .select("anilist_id, status, progress, snapshot, updated_at")
      .eq("user_id", ctx.userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? [])
      .map((row: { anilist_id: number; status: string; progress: number; snapshot: unknown; updated_at: string }) => {
        const snapshot = normaliseSnapshot(row.snapshot);
        if (!snapshot) return null;
        return {
          id: Number(row.anilist_id),
          status: toDbStatus(row.status),
          progress: Number(row.progress) || 0,
          updatedAt: Date.parse(row.updated_at) || 0,
          snapshot,
        } satisfies ListEntry;
      })
      .filter((entry: ListEntry | null): entry is ListEntry => entry !== null);
  });

  if (!result.ok) return readEntries(ctx.storage, key);

  writeEntries(ctx.storage, key, result.data);
  return result.data;
}

export async function getListStatus(
  anilistId: number,
  input?: UserDataContextInput,
): Promise<{ status: ListStatus; progress: number; updatedAt: number } | null> {
  const entries = await listEntries(input);
  const entry = entries.find((item) => Number(item.id) === Number(anilistId));
  if (!entry) return null;
  return { status: entry.status, progress: entry.progress, updatedAt: entry.updatedAt };
}

export async function setListStatus(
  {
    snapshot: media,
    status,
    progress = 0,
    totalEpisodes = 0,
  }: {
    snapshot: unknown;
    status: string;
    progress?: number;
    totalEpisodes?: number;
  },
  input?: UserDataContextInput,
): Promise<boolean> {
  const snapshot = normaliseSnapshot(media);
  if (!snapshot) return false;

  const dbStatus = toDbStatus(status);
  // COMPLETED sets progress to the media's episode count, like the original did.
  const nextProgress = dbStatus === "completed" ? totalEpisodes || progress : progress;

  const ctx = await resolveContext(input);
  const key = localKey(ctx);
  const before = readEntries(ctx.storage, key);
  const updatedAt = ctx.now();
  const entry: ListEntry = { id: snapshot.id, status: dbStatus, progress: nextProgress, updatedAt, snapshot };
  writeEntries(ctx.storage, key, [entry, ...before.filter((item) => Number(item.id) !== snapshot.id)]);

  if (!isSignedIn(ctx)) return true;

  const result = await attempt("lists.set", async () => {
    const { error } = await ctx.client!.from("watchlist").upsert(
      {
        user_id: ctx.userId,
        anilist_id: snapshot.id,
        status: dbStatus,
        progress: nextProgress,
        snapshot,
        updated_at: new Date(updatedAt).toISOString(),
      },
      { onConflict: "user_id,anilist_id" },
    );
    if (error) throw error;
    return true;
  });

  if (!result.ok) {
    writeEntries(ctx.storage, key, before);
    return false;
  }

  return true;
}

export async function removeFromList(anilistId: number, input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  const key = localKey(ctx);
  const before = readEntries(ctx.storage, key);
  writeEntries(ctx.storage, key, before.filter((item) => Number(item.id) !== Number(anilistId)));

  if (!isSignedIn(ctx)) return true;

  const result = await attempt("lists.remove", async () => {
    const { error } = await ctx.client!.from("watchlist")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("anilist_id", Number(anilistId));
    if (error) throw error;
    return true;
  });

  if (!result.ok) {
    writeEntries(ctx.storage, key, before);
    return false;
  }

  return true;
}

export async function listByStatus(
  input?: UserDataContextInput,
): Promise<Record<ListStatus, ListEntry[]>> {
  const entries = await listEntries(input);
  const grouped = Object.fromEntries(LIST_STATUSES.map((status) => [status, [] as ListEntry[]])) as unknown as Record<
    ListStatus,
    ListEntry[]
  >;
  for (const entry of entries) {
    const bucket = grouped[entry.status] ?? (grouped[entry.status] = []);
    bucket.push(entry);
  }
  return grouped;
}

export type ListCounts = { all: number } & Record<ListStatus, number>;

export async function getListCounts(input?: UserDataContextInput): Promise<ListCounts> {
  const entries = await listEntries(input);
  const counts = { all: entries.length } as ListCounts;
  for (const status of LIST_STATUSES) {
    counts[status] = entries.filter((entry) => entry.status === status).length;
  }
  return counts;
}

export type { FavouriteSnapshot };
