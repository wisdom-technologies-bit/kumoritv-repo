// Supabase caps every response at 1000 rows, so an anime with more episodes
// than that (One Piece: 1000+) used to come back truncated. Every query on
// `episodes` for one anime goes through `selectAllEpisodeRows`, which pages
// with `.range(from, to)` until a page returns fewer than a full page.

export const EPISODE_PAGE_SIZE = 1000;

export async function selectAllEpisodeRows(
  db: any,
  anilistId: number,
  columns = "*",
  pageSize = EPISODE_PAGE_SIZE,
): Promise<any[]> {
  if (!db) return [];
  const rows: any[] = [];
  const size = pageSize > 0 ? pageSize : EPISODE_PAGE_SIZE;

  for (let from = 0; ; from += size) {
    const query = db
      .from("episodes")
      .select(columns)
      .eq("anilist_id", anilistId)
      .order("episode_number");
    // `range` pages the request; a client without it (test doubles) still works.
    const paged =
      typeof query?.range === "function" ? query.range(from, from + size - 1) : query;
    const { data, error } = await paged;
    if (error) break;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < size) break;
    // Guard against a driver that ignores `range` and repeats a full page.
    if (rows.length > 100_000) break;
  }

  return rows;
}

export async function getAnimeWithEpisodesFromClient(db: any, anilistId: number) {
  if (!db) return null;

  const { data: anime } = await db
    .from("anime")
    .select("*")
    .eq("anilist_id", anilistId)
    .maybeSingle();
  if (!anime) return null;

  const episodes = await selectAllEpisodeRows(db, anilistId);

  return { anime, episodes };
}
