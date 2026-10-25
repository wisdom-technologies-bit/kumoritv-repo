import { requireCron } from "@/app/lib/discovery/cron-auth";
import { createAdminClient } from "@/app/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireCron(request);
  if (auth) return auth;
  try {
    const db: any = createAdminClient();
    if (!db) throw new Error("supabase_not_configured");
    const [{ data: discovery }, { count: animeCount }, { count: episodeCount }, { data: newest }] = await Promise.all([
      db.from("discovery_state").select("*").order("job"),
      db.from("discovered_anime").select("anilist_id", { count: "exact", head: true }),
      db.from("airing_episodes").select("anilist_id", { count: "exact", head: true }),
      db.from("airing_episodes").select("aired_at").order("aired_at", { ascending: false }).limit(1),
    ]);
    return Response.json({ discovery, counts: { discovered_anime: animeCount, airing_episodes: episodeCount }, newest_aired_at: newest?.[0]?.aired_at ?? null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error), job: "discovery-status" }, { status: 500 });
  }
}
