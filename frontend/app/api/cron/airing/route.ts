import { requireCron } from "@/app/lib/discovery/cron-auth";
import { runDiscovery } from "@/app/lib/discovery/run";
import { fetchAiringWindow, fetchMediaByIds } from "@/app/lib/discovery/anilist";
import { fetchAniPm } from "@/app/lib/discovery/anipm";
import { insertEpisodes, upsertAnime } from "@/app/lib/discovery/store";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { calculateAiringWindow } from "@/app/lib/discovery/airing-window";

 type AniPmItem = { anilist_id: number; episode: number };
type Media = { id: number; title?: { romaji?: string | null; english?: string | null }; coverImage?: { large?: string | null }; isAdult?: boolean; popularity?: number | null; format?: string | null };
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (auth) return auth;
  return runDiscovery(request, "airing", async () => {
    const db: any = createAdminClient();
    if (!db) throw new Error("supabase_not_configured");
    for (const table of ["discovered_anime", "airing_episodes", "discovery_state"]) {
      const { error } = await db.from(table).select("*").limit(1);
      if (error) throw new Error(`schema_unavailable:${table}:${error.message}`);
    }
    const { data: run } = await db.from("discovery_state").select("last_window_end,last_stats").eq("job", "airing").maybeSingle();
    const now = Math.floor(Date.now() / 1000);
    const window = calculateAiringWindow(now, run?.last_window_end, run?.last_stats);
    const from = window.from;
    const seed = window.seeded;
    const stats: any = { pages: 0, schedulesSeen: 0, animeUpserted: 0, episodesInserted: 0, anipmSeen: 0, anipmInserted: 0, anipmError: null, fromUnix: from, toUnix: now, seeded: seed, seed_truncated: false };
    const episodes: Array<Record<string, unknown>> = [];
    let oldestAiringAt = Number.POSITIVE_INFINITY;
    for (let page = 1; page <= 20; page += 1) {
      const result = await fetchAiringWindow(from, now, page);
      stats.pages += 1;
      for (const item of (result.airingSchedules || []) as any[]) {
        if (item.airingAt > now) continue;
        oldestAiringAt = Math.min(oldestAiringAt, item.airingAt);
        stats.schedulesSeen += 1;
        stats.animeUpserted += await upsertAnime([item.media], "anilist");
        episodes.push({ anilist_id: item.media.id, episode: item.episode, aired_at: new Date(item.airingAt * 1000).toISOString(), title: item.media.title?.romaji, title_english: item.media.title?.english, cover_url: item.media.coverImage?.large, is_adult: Boolean(item.media.isAdult), popularity: item.media.popularity, format: item.media.format, source: "anilist" });
      }
      if (!result.pageInfo?.hasNextPage) break;
      if (page === 20 && seed) { stats.seed_truncated = true; }
      await new Promise((resolve) => setTimeout(resolve, seed ? 1000 : 100));
    }
    if (Number.isFinite(oldestAiringAt)) stats.oldest_airing_at = new Date(oldestAiringAt * 1000).toISOString();
    stats.episodesInserted = await insertEpisodes(episodes);
    if (!seed) {
      try {
        const pm = await fetchAniPm(); stats.anipmSeen = pm.items.length; stats.anipmError = pm.error;
        const media = (await fetchMediaByIds(Array.from(new Set(pm.items.map((item: AniPmItem) => item.anilist_id))))) as Media[];
        const byId = new Map(media.map((item: Media) => [item.id, item]));
        const missing = pm.items.map((item: AniPmItem) => ({ ...item, media: byId.get(item.anilist_id) })).filter((item: { media?: Media }) => item.media);
        stats.anipmInserted = await insertEpisodes(missing.map((item: AniPmItem & { media?: Media }) => ({ anilist_id: item.anilist_id, episode: item.episode, aired_at: new Date().toISOString(), title: item.media?.title?.romaji || `Anime ${item.anilist_id}`, title_english: item.media?.title?.english || null, cover_url: item.media?.coverImage?.large || null, is_adult: Boolean(item.media?.isAdult), popularity: item.media?.popularity ?? null, format: item.media?.format ?? null, source: "anipm" })));
      } catch (error) { stats.anipmError = error instanceof Error ? error.message : String(error); }
    }
    return stats;
  });
}
export const POST = GET;
