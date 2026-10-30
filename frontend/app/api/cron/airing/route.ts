import { requireCron } from "@/app/lib/discovery/cron-auth";
import { runDiscovery } from "@/app/lib/discovery/run";
import { fetchAiringWindow, fetchMediaByIds } from "@/app/lib/discovery/anilist";
import { fetchAniPm } from "@/app/lib/discovery/anipm";
import { insertEpisodeRows, upsertAnime, queuePendingSync } from "@/app/lib/discovery/store";
import { enqueueMissingAnime } from "@/app/lib/anime-db/queue";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { calculateAiringWindow } from "@/app/lib/discovery/airing-window";

type AniPmItem = { anilist_id: number; episode: number };
type Media = {
  id: number;
  title?: { romaji?: string | null; english?: string | null };
  coverImage?: { large?: string | null };
  isAdult?: boolean;
  popularity?: number | null;
  format?: string | null;
};

export const maxDuration = 240;

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

    const stats: any = {
      pages: 0,
      schedulesSeen: 0,
      animeUpserted: 0,
      episodesInserted: 0,
      pendingSyncQueued: 0,
      animeEnqueued: 0,
      anipmSeen: 0,
      anipmInserted: 0,
      anipmError: null,
      fromUnix: from,
      toUnix: now,
      seeded: seed,
      seed_truncated: false,
    };

    const episodes: Array<Record<string, unknown>> = [];
    // Everything needed by the two queue steps below.
    const mediaSeen: Media[] = [];
    const adultIds = new Set<number>();
    let oldestAiringAt = Number.POSITIVE_INFINITY;

    for (let page = 1; page <= 20; page += 1) {
      const result = await fetchAiringWindow(from, now, page);
      stats.pages += 1;

      for (const item of (result.airingSchedules || []) as any[]) {
        if (item.airingAt > now) continue;

        oldestAiringAt = Math.min(oldestAiringAt, item.airingAt);
        stats.schedulesSeen += 1;
        stats.animeUpserted += await upsertAnime([item.media], "anilist");

        const media: Media = item.media;
        mediaSeen.push(media);
        if (media.isAdult) adultIds.add(Number(media.id));

        episodes.push({
          anilist_id: item.media.id,
          episode: item.episode,
          aired_at: new Date(item.airingAt * 1000).toISOString(),
          title: item.media.title?.romaji,
          title_english: item.media.title?.english,
          cover_url: item.media.coverImage?.large,
          is_adult: Boolean(item.media.isAdult),
          popularity: item.media.popularity,
          format: item.media.format,
          source: "anilist",
        });
      }

      if (!result.pageInfo?.hasNextPage) break;
      if (page === 20 && seed) { stats.seed_truncated = true; }
      await new Promise((resolve) => setTimeout(resolve, seed ? 1000 : 100));
    }

    if (Number.isFinite(oldestAiringAt)) stats.oldest_airing_at = new Date(oldestAiringAt * 1000).toISOString();

    // Only the rows the table actually kept are "newly seen": that is what the
    // sync job needs to import, not the whole window every run.
    const insertedAnilist = await insertEpisodeRows(episodes);
    stats.episodesInserted = insertedAnilist.length;

    let insertedAniPm: Array<{ anilist_id: number; episode: number }> = [];

    if (!seed) {
      try {
        const pm = await fetchAniPm();
        stats.anipmSeen = pm.items.length;
        stats.anipmError = pm.error;

        const media = (await fetchMediaByIds(Array.from(new Set(pm.items.map((item: AniPmItem) => item.anilist_id))))) as Media[];
        const byId = new Map(media.map((item: Media) => [item.id, item]));
        const missing = pm.items
          .map((item: AniPmItem) => ({ ...item, media: byId.get(item.anilist_id) }))
          .filter((item: { media?: Media }) => item.media);

        for (const item of missing) {
          mediaSeen.push(item.media as Media);
          if (item.media?.isAdult) adultIds.add(Number(item.anilist_id));
        }

        insertedAniPm = await insertEpisodeRows(
          missing.map((item: AniPmItem & { media?: Media }) => ({
            anilist_id: item.anilist_id,
            episode: item.episode,
            aired_at: new Date().toISOString(),
            title: item.media?.title?.romaji || `Anime ${item.anilist_id}`,
            title_english: item.media?.title?.english || null,
            cover_url: item.media?.coverImage?.large || null,
            is_adult: Boolean(item.media?.isAdult),
            popularity: item.media?.popularity ?? null,
            format: item.media?.format ?? null,
            source: "anipm",
          })),
        );

        stats.anipmInserted = insertedAniPm.length;
      } catch (error) {
        stats.anipmError = error instanceof Error ? error.message : String(error);
      }
    }

    // THE PIPELINE FIX (part 1): the sync job reads pending_sync and runs
    // importAnime, which writes `episodes`. Nothing used to write pending_sync, so
    // new episodes never appeared anywhere. One row per newly seen aired episode,
    // deduplicated by the (anilist_id, episode_number) unique index, adults skipped.
    stats.pendingSyncQueued = await queuePendingSync(
      db,
      [...insertedAnilist, ...insertedAniPm],
      { skipAnilistIds: adultIds, chunkSize: 500 },
    );

    // THE PIPELINE FIX (part 2): anime that aired but have no `anime` row get an
    // import-queue entry, so /media/{id} and /watch/{id} pages exist at all.
    stats.animeEnqueued = await enqueueMissingAnime(mediaSeen, "airing", 10, { db });

    console.log("[airing] run summary", JSON.stringify({
      pages: stats.pages,
      schedulesSeen: stats.schedulesSeen,
      episodesInserted: stats.episodesInserted,
      pendingSyncQueued: stats.pendingSyncQueued,
      animeEnqueued: stats.animeEnqueued,
      anipmInserted: stats.anipmInserted,
      anipmError: stats.anipmError,
      seeded: seed,
    }));

    return stats;
  });
}

export const POST = GET;
