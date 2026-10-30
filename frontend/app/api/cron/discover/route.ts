import { requireCron } from "@/app/lib/discovery/cron-auth";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { runDiscovery } from "@/app/lib/discovery/run";
import { fetchRecentStarts, resolveAniListIds, fetchMediaByIds } from "@/app/lib/discovery/anilist";
import { shikimoriList, malId } from "@/app/lib/discovery/shikimori";
import { insertEpisodes, upsertAnime } from "@/app/lib/discovery/store";
import { enqueueMissingAnime } from "@/app/lib/anime-db/queue";

export const maxDuration = 240;

/**
 * Finds anime that exist but are not in our database yet.
 *
 * It writes `discovered_anime` (the catalogue of what we know about) and, from
 * prompt 18 on, it also feeds the import queue: every non-adult title with no
 * `anime` row goes through enqueueAnime in chunks of 50, capped at 200 per run,
 * most popular first. Before that, `discovered_anime` grew while `anime` (and so
 * every /media page) stayed empty.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (auth) return auth;

  return runDiscovery(request, "discover", async () => {
    const db: any = createAdminClient();
    if (!db) throw new Error("supabase_not_configured");

    for (const table of ["discovered_anime", "airing_episodes", "discovery_state"]) {
      const { error } = await db.from(table).select("*").limit(1);
      if (error) throw new Error(`schema_unavailable:${table}:${error.message}`);
    }

    const stats: any = {
      anilist: { seen: 0, inserted: 0 },
      ongoing: { seen: 0, mapped: 0, inserted: 0, error: null },
      anons: { seen: 0, mapped: 0, inserted: 0, error: null },
      released: { seen: 0, mapped: 0, inserted: 0, error: null },
      animeEnqueued: 0,
    };

    const cutoff = new Date(Date.now() - 30 * 86400000);
    const catalog: any[] = [];
    // Everything discovered this run, handed to the import queue at the end.
    const mediaSeen: any[] = [];

    for (let p = 1; p <= 3; p++) {
      const page = await fetchRecentStarts(Number(cutoff.toISOString().slice(0, 10).replace(/-/g, "")), p);
      catalog.push(...(page.media || []));
      stats.anilist.seen += page.media?.length || 0;
      if (!page.pageInfo?.hasNextPage) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    stats.anilist.inserted = await upsertAnime(catalog, "anilist-catalog");
    mediaSeen.push(...catalog);

    for (const [name, query, pages] of [
      ["ongoing", "status=ongoing&order=popularity", 10],
      ["anons", "status=anons&order=popularity", 2],
      ["released", `status=released&season=${new Date().getUTCFullYear()}&order=aired_on`, 3],
    ] as Array<[string, string, number]>) {
      try {
        const items = await shikimoriList(query, pages);
        stats[name].seen = items.length;

        const mapped = await resolveAniListIds(items.map((item: any) => malId(item.id)).filter(Boolean));
        stats[name].mapped = mapped.length;

        const media = await fetchMediaByIds(mapped.map((item: any) => item.id));
        stats[name].inserted = await upsertAnime(media, "shikimori");
        mediaSeen.push(...media);

        if (name === "released") {
          stats[name].inserted += await insertEpisodes(
            media
              .filter((m: any) =>
                items.some((item: any) => malId(item.id) === m.id && new Date(item.aired_on || item.released_on || 0) >= cutoff),
              )
              .map((m: any) => ({
                anilist_id: m.id,
                episode: 1,
                aired_at: new Date().toISOString(),
                title: m.title?.romaji,
                title_english: m.title?.english,
                cover_url: m.coverImage?.large,
                is_adult: Boolean(m.isAdult),
                popularity: m.popularity,
                format: m.format,
                source: "shikimori",
              })),
          );
        }
      } catch (e) {
        stats[name].error = e instanceof Error ? e.message : String(e);
      }
    }

    // Non-adult titles with no `anime` row go into anime_import_queue.
    stats.animeEnqueued = await enqueueMissingAnime(mediaSeen, "discover", 5, { db, max: 200 });

    console.log("[discover] run summary", JSON.stringify({
      discovered: stats.anilist.inserted,
      animeEnqueued: stats.animeEnqueued,
      ongoing: stats.ongoing.inserted,
      anons: stats.anons.inserted,
      released: stats.released.inserted,
      errors: [stats.ongoing.error, stats.anons.error, stats.released.error].filter(Boolean).length,
    }));

    return stats;
  });
}

export const POST = GET;
