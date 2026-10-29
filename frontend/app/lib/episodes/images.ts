// Batched fallback for Keep Watching thumbnails: old progress entries have no
// episode image, so the pairs shown on the homepage are resolved in ONE query
// for `episodes.image_url`, then the anime cover, then a neutral placeholder.
//
// Nothing here throws: a failed lookup simply returns no image and the card
// keeps its placeholder.

export type ImageRequest = { anilistId: number; episode: number };

export type ImageResult = Record<string, string | null>;

export const imageKey = (anilistId: number, episode: number) =>
  `${anilistId}-${episode}`;

export function normaliseImageRequests(input: unknown): ImageRequest[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ImageRequest[] = [];
  for (const item of input) {
    const anilistId = Number((item as any)?.anilistId ?? (item as any)?.id);
    const episode = Number((item as any)?.episode);
    if (!Number.isInteger(anilistId) || anilistId <= 0) continue;
    if (!Number.isInteger(episode) || episode < 1) continue;
    const key = imageKey(anilistId, episode);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ anilistId, episode });
    if (out.length >= 60) break;
  }
  return out;
}

const PAGE = 1000;

async function episodeImageRows(db: any, ids: number[]) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const query = db
      .from("episodes")
      .select("anilist_id,episode_number,image_url")
      .in("anilist_id", ids)
      .order("episode_number");
    const paged =
      typeof query?.range === "function" ? query.range(from, from + PAGE - 1) : query;
    const { data, error } = await paged;
    if (error) break;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE) break;
    if (rows.length > 50_000) break;
  }
  return rows;
}

export type ImageDeps = {
  readEpisodeImages: (ids: number[]) => Promise<any[]>;
  readAnimeCovers: (ids: number[]) => Promise<any[]>;
  readAniListCover: (anilistId: number) => Promise<string | null>;
};

/**
 * Order: episode thumbnail -> anime cover -> null (the card shows a neutral
 * placeholder). Dependencies are injectable for tests.
 */
export async function resolveImages(
  requests: ImageRequest[],
  deps: ImageDeps,
): Promise<ImageResult> {
  const result: ImageResult = {};
  if (!requests.length) return result;
  const ids = [...new Set(requests.map((request) => request.anilistId))];

  let episodeRows: any[] = [];
  try {
    episodeRows = await deps.readEpisodeImages(ids);
  } catch {
    episodeRows = [];
  }
  const episodeImages = new Map<string, string>();
  for (const row of episodeRows) {
    const url = typeof row?.image_url === "string" ? row.image_url.trim() : "";
    if (!url) continue;
    episodeImages.set(
      imageKey(Number(row.anilist_id), Number(row.episode_number)),
      url,
    );
  }

  const missing = requests.filter(
    (request) => !episodeImages.get(imageKey(request.anilistId, request.episode)),
  );

  const covers = new Map<number, string>();
  if (missing.length) {
    try {
      const animeRows = await deps.readAnimeCovers([
        ...new Set(missing.map((request) => request.anilistId)),
      ]);
      for (const row of animeRows) {
        const url = typeof row?.cover_url === "string" ? row.cover_url.trim() : "";
        if (url) covers.set(Number(row.anilist_id), url);
      }
    } catch {
      /* fall through to AniList */
    }
  }

  const needAniList = [
    ...new Set(
      missing
        .filter((request) => !covers.get(request.anilistId))
        .map((request) => request.anilistId),
    ),
  ].slice(0, 5);
  for (const anilistId of needAniList) {
    try {
      const cover = await deps.readAniListCover(anilistId);
      if (cover) covers.set(anilistId, cover);
    } catch {
      /* ignore */
    }
  }

  for (const request of requests) {
    const key = imageKey(request.anilistId, request.episode);
    result[key] =
      episodeImages.get(key) || covers.get(request.anilistId) || null;
  }

  return result;
}
