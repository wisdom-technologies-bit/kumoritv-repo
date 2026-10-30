import "server-only";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createClient } from "@/app/lib/supabase/server";
import { getAnimeWithEpisodesFromClient } from "./queries";
import { getMediaInfoResult } from "@/app/lib/anilist/medias.server";
import { getEpisodes, AnivexaTimeout, AnivexaHttpError } from "@/app/lib/anivexa/client";
import { mergeEpisodes } from "@/app/lib/anivexa/merge";

type AnimeRow = any; type Snapshot = any;
const flights = new Map<number, Promise<ImportResult>>(); let active = 0; const waiters: (() => void)[] = [];
/**
 * `systemic` marks a failure that says nothing about this anime: AniList or
 * AniVexa being rate limited / down / slow. The import queue must reschedule it
 * without burning an attempt, because the same call works later.
 */
export type ImportResult = {
  status: "ok"|"no_streams"|"not_found"|"error";
  episodes: number;
  message?: string;
  systemic?: boolean;
  /** How long AniList asked us to wait (429 / Retry-After), when it said so. */
  retryAfterMs?: number;
};

/** Messages that mean "try again later", never "this anime is broken". */
const SYSTEMIC_MESSAGE = [
  /AniList rate limited/i,
  /AniList metadata unavailable/i,
  /AniList request throttle/i,
  /AniList is unavailable/i,
  /AniList HTTP 5\d\d/i,
  /AniList HTTP 429/i,
  /\b429\b/,
  /\b5\d{2}\b/,
  /timed out/i,
  /timeout/i,
  /HTTP 429/,
  /HTTP 5\d\d/,
  /server error 5\d\d/i,
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i,
];

export function isSystemicFailure(result: { message?: string | null; systemic?: boolean } | null | undefined): boolean {
  if (!result) return false;
  if (result.systemic) return true;
  const message = result.message || "";
  return SYSTEMIC_MESSAGE.some((pattern) => pattern.test(message));
}
const strip = (s: any) => typeof s === "string" ? s.replace(/<[^>]*>/g, "").trim() : s ?? null;
async function slot() { if (active < 3) { active++; return; } await new Promise<void>((r) => waiters.push(r)); active++; }
function release() { active--; waiters.shift()?.(); }
export async function importAnime(anilistId: number, options: { source:"open"|"queue"|"cron"; snapshot?: Snapshot; timeoutMs?: number; refreshMetadata?: boolean }): Promise<ImportResult> {
  if (!Number.isInteger(anilistId) || anilistId <= 0 || anilistId >= 1_000_000_000) return { status:"error", episodes:0, message:"Invalid AniList ID" };
  const existing = flights.get(anilistId); if (existing) return existing;
  const promise = (async (): Promise<ImportResult> => { await slot(); try {
    const db: any = createAdminClient(); if (!db) return { status:"error", episodes:0, message:"Supabase admin client unavailable" };
    const { data: current } = await db.from("anime").select("*").eq("anilist_id", anilistId).maybeSingle();
    const refreshMetadata = options.refreshMetadata ?? options.source === "open";
    const recent = current?.updated_at && Date.now() - new Date(current.updated_at).getTime() < 3 * 86400000;
    let media: any = options.snapshot || null;

    if (!media && (refreshMetadata || !current || !recent)) {
      const lookup = await getMediaInfoResult({ id: anilistId });

      if (lookup.status === "ok") media = lookup.media;

      if (lookup.status === "rate_limited") {
        // Rate limiting is about us, not about this anime: reschedule, do not
        // count it as an attempt. Logged once per run inside the client.
        return { status:"error", episodes:0, message:"AniList rate limited", systemic:true, retryAfterMs: lookup.retryAfterMs };
      }

      if (lookup.status === "not_found" && !current) return { status:"not_found", episodes:0, message:"AniList media not found" };

      if (lookup.status === "unavailable" && !current) {
        return { status:"error", episodes:0, message:`AniList metadata unavailable: ${lookup.message}`, systemic:true };
      }
    }

    if (!media && !current) return { status:"error", episodes:0, message:"AniList metadata unavailable", systemic:true };
    const title = media?.title || {}; const cover = media?.coverImage || {};
    if (media) { await db.from("anime").upsert({ anilist_id:anilistId, title:title.english || title.romaji || title.native || current?.title || String(anilistId), title_romaji:title.romaji ?? null, title_english:title.english ?? null, title_native:title.native ?? null, description:strip(media.description), cover_url:cover.extraLarge || cover.large || null, banner_url:media.bannerImage || null, format:media.format || null, status:media.status || null, season:media.season || null, season_year:media.seasonYear || null, total_episodes:media.episodes ?? current?.total_episodes ?? null, duration:media.duration ?? null, genres:media.genres || [], score:media.averageScore ?? null, is_adult:!!media.isAdult, mal_id:media.idMal ?? null }, { onConflict:"anilist_id" }); }
    let parsed; try { parsed = await getEpisodes(anilistId, { timeoutMs: options.timeoutMs }); } catch (error) {
      if (error instanceof AnivexaTimeout) return { status:"error", episodes:0, message:error.message, systemic:true };
      if (error instanceof AnivexaHttpError) {
        const systemic = error.status === 429 || error.status >= 500;
        return { status:"error", episodes:0, message:error.message, systemic };
      }
      return { status:"error", episodes:0, message:String(error), systemic:isSystemicFailure({ message:String(error) }) };
    }
    if (parsed.isNotFound) { await db.from("anime").update({ not_found_on_anivexa:true, last_checked_at:new Date().toISOString() }).eq("anilist_id", anilistId); return { status:"not_found", episodes:0 }; }
    const rows = mergeEpisodes(parsed, anilistId); for (let i=0;i<rows.length;i+=200) { const chunk=rows.slice(i,i+200); await db.from("episodes").upsert(chunk, { onConflict:"play_id", ignoreDuplicates:false }); }
    await db.from("anime").update({ mappings:parsed.mappings, has_streams:rows.some((r)=>r.sub_providers.length || r.dub_providers.length), not_found_on_anivexa:false, episodes_synced_at:new Date().toISOString(), last_checked_at:new Date().toISOString(), total_episodes:current?.total_episodes ?? (rows.length || null) }).eq("anilist_id", anilistId);
    return { status: rows.length ? "ok" : "no_streams", episodes:rows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status:"error", episodes:0, message, systemic:isSystemicFailure({ message }) };
  } finally { release(); flights.delete(anilistId); } })(); flights.set(anilistId, promise); return promise;
}
export function needsImport(row: AnimeRow | null): boolean { if (!row || !row.episodes_synced_at) return true; const age=Date.now()-new Date(row.last_checked_at || row.episodes_synced_at).getTime(); if (row.not_found_on_anivexa) return age > (row.status === "RELEASING" ? 6 : 24)*3600000; if (!row.has_streams) return age > 3600000; return age > (row.status === "RELEASING" || row.status === "NOT_YET_RELEASED" ? 30*60000 : 7*86400000); }
export async function getAnimeWithEpisodes(anilistId: number) {
  const db = createClient();
  return await getAnimeWithEpisodesFromClient(db, anilistId);
}
