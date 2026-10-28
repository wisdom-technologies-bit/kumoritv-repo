import manga from "@/app/api/consumet/consumetManga";
import { MediaDataFullInfo } from "../../ts/interfaces/anilistMediaData";
import { MangadexMangaChapters } from "@/app/ts/interfaces/mangadex";

/**
 * The chapter list for an AniList manga. MangaDex matching now happens on the
 * server (see app/lib/manga/mangadex.ts), so the AniList id is enough: no more
 * title guessing here.
 */
export async function getMangaChaptersForMedia(
  mediaInfo: Pick<MediaDataFullInfo, "id">,
): Promise<MangadexMangaChapters[] | null> {
  return manga.getMangaChapters({ id: mediaInfo.id });
}

/** Kept for callers that still ask "which MangaDex entry is this?": the chapter
 *  source is keyed by the AniList id, so the answer is the id itself. */
export async function getClosestMangaResultByTitle(
  _query: string,
  mediaInfo: Pick<MediaDataFullInfo, "id">,
): Promise<string | null> {
  return mediaInfo?.id ? String(mediaInfo.id) : null;
}
