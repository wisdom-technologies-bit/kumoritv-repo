import "server-only";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { createClient } from "@/app/lib/supabase/server";
import { getAnimeWithEpisodesFromClient } from "./queries";
import { getMediaInfo } from "@/app/lib/anilist/medias.server";
import { getEpisodes, AnivexaTimeout, AnivexaHttpError } from "@/app/lib/anivexa/client";
import { mergeEpisodes } from "@/app/lib/anivexa/merge";

type AnimeRow = any; type Snapshot = any;
const flights = new Map<number, Promise<ImportResult>>(); let active = 0; const waiters: (() => void)[] = [];
export type ImportResult = { status: "ok"|"no_streams"|"not_found"|"error"; episodes: number; message?: string };
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
    const media = options.snapshot || (refreshMetadata || !current || !recent ? await getMediaInfo({ id: anilistId }) : null);
    if (!media && !current) return { status:"error", episodes:0, message:"AniList metadata unavailable" };
    const title = media?.title || {}; const cover = media?.coverImage || {};
    if (media) { await db.from("anime").upsert({ anilist_id:anilistId, title:title.english || title.romaji || title.native || current?.title || String(anilistId), title_romaji:title.romaji ?? null, title_english:title.english ?? null, title_native:title.native ?? null, description:strip(media.description), cover_url:cover.extraLarge || cover.large || null, banner_url:media.bannerImage || null, format:media.format || null, status:media.status || null, season:media.season || null, season_year:media.seasonYear || null, total_episodes:media.episodes ?? current?.total_episodes ?? null, duration:media.duration ?? null, genres:media.genres || [], score:media.averageScore ?? null, is_adult:!!media.isAdult, mal_id:media.idMal ?? null }, { onConflict:"anilist_id" }); }
    let parsed; try { parsed = await getEpisodes(anilistId, { timeoutMs: options.timeoutMs }); } catch (error) { if (error instanceof AnivexaTimeout || error instanceof AnivexaHttpError) return { status:"error", episodes:0, message:error.message }; return { status:"error", episodes:0, message:String(error) }; }
    if (parsed.isNotFound) { await db.from("anime").update({ not_found_on_anivexa:true, last_checked_at:new Date().toISOString() }).eq("anilist_id", anilistId); return { status:"not_found", episodes:0 }; }
    const rows = mergeEpisodes(parsed, anilistId); for (let i=0;i<rows.length;i+=200) { const chunk=rows.slice(i,i+200); await db.from("episodes").upsert(chunk, { onConflict:"play_id", ignoreDuplicates:false }); }
    await db.from("anime").update({ mappings:parsed.mappings, has_streams:rows.some((r)=>r.sub_providers.length || r.dub_providers.length), not_found_on_anivexa:false, episodes_synced_at:new Date().toISOString(), last_checked_at:new Date().toISOString(), total_episodes:current?.total_episodes ?? (rows.length || null) }).eq("anilist_id", anilistId);
    return { status: rows.length ? "ok" : "no_streams", episodes:rows.length };
  } catch (error) { return { status:"error", episodes:0, message:error instanceof Error ? error.message : String(error) }; } finally { release(); flights.delete(anilistId); } })(); flights.set(anilistId, promise); return promise;
}
export function needsImport(row: AnimeRow | null): boolean { if (!row || !row.episodes_synced_at) return true; const age=Date.now()-new Date(row.last_checked_at || row.episodes_synced_at).getTime(); if (row.not_found_on_anivexa) return age > (row.status === "RELEASING" ? 6 : 24)*3600000; if (!row.has_streams) return age > 3600000; return age > (row.status === "RELEASING" || row.status === "NOT_YET_RELEASED" ? 30*60000 : 7*86400000); }
export async function getAnimeWithEpisodes(anilistId: number) {
  const db = createClient();
  return await getAnimeWithEpisodesFromClient(db, anilistId);
}
