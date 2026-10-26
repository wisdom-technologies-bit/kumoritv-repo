export async function getWatchEpisodeResult(
  db: any,
  anilistId: string | number,
  episode: string | number,
) {
  return await db
    .from("episodes")
    .select("*")
    .eq("play_id", `${anilistId}-${episode}`)
    .maybeSingle();
}
