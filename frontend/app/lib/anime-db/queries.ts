export async function getAnimeWithEpisodesFromClient(db: any, anilistId: number) {
  if (!db) return null;

  const { data: anime } = await db
    .from("anime")
    .select("*")
    .eq("anilist_id", anilistId)
    .maybeSingle();
  if (!anime) return null;

  const { data: episodes } = await db
    .from("episodes")
    .select("*")
    .eq("anilist_id", anilistId)
    .order("episode_number");

  return { anime, episodes: episodes || [] };
}
