import { createAdminClient } from "@/app/lib/supabase/admin";
import { importAnime } from "@/app/lib/anime-db/import";
import { selectAllEpisodeRows } from "@/app/lib/anime-db/queries";
import { mapEpisodeRows } from "@/app/lib/episodes/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const flights = new Map<number, Promise<unknown>>();

// Every episode column the list and the synopsis need. `duration` is in
// SECONDS in the table (AniVexa's minutes are converted by mergeEpisodes).
const COLUMNS =
  "episode_number,title,description,image_url,air_date,duration,filler,recap,sub_providers,dub_providers";

export async function GET(
  request: Request,
  { params }: { params: { anilistId: string } },
) {
  const id = Number(params.anilistId);
  const unavailable = () =>
    Response.json({ status: "unavailable", episodes: [], updatedAt: null });
  if (!Number.isInteger(id) || id <= 0) return unavailable();
  const db = createAdminClient();
  if (!db) return unavailable();

  let { data: anime }: { data: any } = await db
    .from("anime")
    .select("*")
    .eq("anilist_id", id)
    .maybeSingle();
  let rows = await selectAllEpisodeRows(db, id, COLUMNS);

  if (!anime || !rows.length) {
    let flight = flights.get(id);
    if (!flight) {
      flight = importAnime(id, { source: "open", timeoutMs: 20000 });
      flights.set(id, flight);
      flight.finally(() => flights.delete(id));
    }
    await Promise.race([flight, new Promise((r) => setTimeout(r, 20000))]);
    ({ data: anime } = await db
      .from("anime")
      .select("*")
      .eq("anilist_id", id)
      .maybeSingle());
    rows = await selectAllEpisodeRows(db, id, COLUMNS);
  }

  if (!rows.length)
    return Response.json({
      status: anime?.not_found_on_anivexa ? "unavailable" : "syncing",
      episodes: [],
      updatedAt: anime?.updated_at || null,
    });

  // Paginated above, so a 1000+ episode anime comes back complete and in order.
  const episodes = mapEpisodeRows(rows);

  return new Response(
    JSON.stringify({
      status: "ready",
      episodes,
      updatedAt: anime?.updated_at || null,
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
