import { requireCron } from "@/app/lib/discovery/cron-auth";
import { runDiscovery } from "@/app/lib/discovery/run";
import { fetchAiringWindow, fetchMediaByIds } from "@/app/lib/discovery/anilist";
import { fetchAniPm } from "@/app/lib/discovery/anipm";
import { insertEpisodes, upsertAnime } from "@/app/lib/discovery/store";
import { createAdminClient } from "@/app/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 240;

type AniPmItem = { anilist_id: number; episode: number };

type Media = {
  id: number;
  title?: { romaji?: string | null; english?: string | null };
  coverImage?: { large?: string | null };
  isAdult?: boolean;
  popularity?: number | null;
  format?: string | null;
};

export async function GET(request: Request) {
  const auth = requireCron(request);
  if (auth) return auth;

  return runDiscovery(request, "airing", async () => {
    const db: any = createAdminClient();
    if (!db) throw new Error("supabase_not_configured");
    const { data: run } = await db.from("cron_runs").select("last_window_end").eq("job", "airing").maybeSingle();
    const now = Math.floor(Date.now() / 1000);
    const from = run?.last_window_end
      ? Math.max(now - 172800, Math.floor(new Date(run.last_window_end).getTime() / 1000) - 3600)
      : now - 2592000;
    const seed = !run?.last_window_end;
    const stats = { pages: 0, schedulesSeen: 0, animeUpserted: 0, episodesInserted: 0, anipmSeen: 0, anipmInserted: 0, anipmError: null as string | null };
    const episodes: Array<Record<string, unknown>> = [];

    for (let page = 1; page <= 20; page += 1) {
      const result = await fetchAiringWindow(from, now, page);
      stats.pages += 1;
      for (const item of result.airingSchedules || []) {
        if (item.airingAt > now) continue;
        stats.schedulesSeen += 1;
        stats.animeUpserted += await upsertAnime([item.media], "anilist");
        episodes.push({ anilist_id: item.media.id, episode: item.episode, aired_at: new Date(item.airingAt * 1000).toISOString(), title: item.media.title?.romaji, title_english: item.media.title?.english, cover_url: item.media.coverImage?.large, is_adult: Boolean(item.media.isAdult), popularity: item.media.popularity, format: item.media.format, source: "anilist" });
      }
      if (!result.pageInfo?.hasNextPage) break;
      await new Promise((resolve) => setTimeout(resolve, seed ? 1000 : 100));
    }
    stats.episodesInserted = await insertEpisodes(episodes);

    if (!seed) {
      try {
        const pm = await fetchAniPm();
        stats.anipmSeen = pm.items.length;
        stats.anipmError = pm.error;
        const media = (await fetchMediaByIds(Array.from(new Set(pm.items.map((item: AniPmItem) => item.anilist_id))))) as Media[];
        const byId = new Map(media.map((item) => [item.id, item]));
        const missing = (pm.items as AniPmItem[]).map((item) => ({ ...item, media: byId.get(item.anilist_id) })).filter((item) => item.media);
        stats.anipmInserted = await insertEpisodes(missing.map((item) => ({ anilist_id: item.anilist_id, episode: item.episode, aired_at: new Date().toISOString(), title: item.media?.title?.romaji || `Anime ${item.anilist_id}`, title_english: item.media?.title?.english || null, cover_url: item.media?.coverImage?.large || null, is_adult: Boolean(item.media?.isAdult), popularity: item.media?.popularity ?? null, format: item.media?.format ?? null, source: "anipm" })));
      } catch (error) {
        stats.anipmError = error instanceof Error ? error.message : String(error);
      }
    }
    return stats;
  });
}

export const POST = GET;
