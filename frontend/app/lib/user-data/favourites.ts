"use client";
// Favourites: localStorage for guests, Supabase `favourites` for signed-in users.

import { attempt, isSignedIn, resolveContext, type UserDataContextInput } from "./context";
import { normaliseSnapshot, normaliseSnapshotList } from "./normalise";
import { readJson, writeJson } from "./storage";
import type { FavouriteSnapshot } from "./types";

export const GUEST_FAVOURITES_KEY = "kumori_favourites_v1";

export function favouritesCacheKey(userId: string): string {
  return `kumori_favourites_cache_${userId}`;
}

function localKey(ctx: { userId: string | null; client: unknown }): string {
  return ctx.userId && ctx.client ? favouritesCacheKey(ctx.userId) : GUEST_FAVOURITES_KEY;
}

export async function listFavourites(input?: UserDataContextInput): Promise<FavouriteSnapshot[]> {
  const ctx = await resolveContext(input);
  const key = localKey(ctx);

  if (!isSignedIn(ctx)) return readJson<FavouriteSnapshot[]>(ctx.storage, key, []);

  const result = await attempt("favourites.list", async () => {
    const { data, error } = await ctx.client!.from("favourites")
      .select("anilist_id, snapshot, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return normaliseSnapshotList((data ?? []).map((row: { snapshot: unknown }) => row.snapshot));
  });

  if (!result.ok) return readJson<FavouriteSnapshot[]>(ctx.storage, key, []);

  writeJson(ctx.storage, key, result.data);
  return result.data;
}

export async function isFavourite(anilistId: number, input?: UserDataContextInput): Promise<boolean> {
  const list = await listFavourites(input);
  return list.some((item) => Number(item.id) === Number(anilistId));
}

export async function addFavourite(media: unknown, input?: UserDataContextInput): Promise<boolean> {
  const snapshot = normaliseSnapshot(media);
  if (!snapshot) return false;

  const ctx = await resolveContext(input);
  const key = localKey(ctx);
  const before = readJson<FavouriteSnapshot[]>(ctx.storage, key, []);
  const next = [snapshot, ...before.filter((item) => Number(item.id) !== snapshot.id)];
  writeJson(ctx.storage, key, next);

  if (!isSignedIn(ctx)) return true;

  const result = await attempt("favourites.add", async () => {
    const { error } = await ctx.client!.from("favourites").upsert(
      {
        user_id: ctx.userId,
        anilist_id: snapshot.id,
        snapshot,
        created_at: new Date(ctx.now()).toISOString(),
      },
      { onConflict: "user_id,anilist_id" },
    );
    if (error) throw error;
    return true;
  });

  if (!result.ok) {
    writeJson(ctx.storage, key, before);
    return false;
  }

  return true;
}

export async function removeFavourite(anilistId: number, input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  const key = localKey(ctx);
  const before = readJson<FavouriteSnapshot[]>(ctx.storage, key, []);
  writeJson(
    ctx.storage,
    key,
    before.filter((item) => Number(item.id) !== Number(anilistId)),
  );

  if (!isSignedIn(ctx)) return true;

  const result = await attempt("favourites.remove", async () => {
    const { error } = await ctx.client!.from("favourites")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("anilist_id", Number(anilistId));
    if (error) throw error;
    return true;
  });

  if (!result.ok) {
    writeJson(ctx.storage, key, before);
    return false;
  }

  return true;
}

export async function clearFavourites(input?: UserDataContextInput): Promise<boolean> {
  const ctx = await resolveContext(input);
  const key = localKey(ctx);
  writeJson(ctx.storage, key, []);

  if (!isSignedIn(ctx)) return true;

  const result = await attempt("favourites.clear", async () => {
    const { error } = await ctx.client!.from("favourites").delete().eq("user_id", ctx.userId);
    if (error) throw error;
    return true;
  });
  return result.ok;
}
