import {
  MangadexMangaChapters,
  MangadexMangaPages,
  MangadexMangaSearchResult,
} from "@/app/ts/interfaces/mangadex";

// Manga now comes from this site's own /api/manga routes (MangaDex directly).
// The exported names and return shapes are unchanged, so the existing UI error
// paths keep working: `null` means "could not load".
// The old Express manga backend is gone: nothing here reads a backend URL.

type ChaptersResponse = { status: "ready" | "unavailable" | "error"; chapters: MangadexMangaChapters[] };
type PagesResponse = { status: "ready" | "unavailable" | "error"; pages: MangadexMangaPages[] };

function baseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  // In the browser a relative URL is enough.
  if (typeof window !== "undefined") return "";
  const vercel = process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "";
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${baseUrl()}${path}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch (error) {
    console.error("Mangadex: " + (error instanceof Error ? error.message : String(error)));
    return null;
  }
}

/** Same request as `getMangaChapters`, but keeps the source status so the UI can
 *  tell "not on MangaDex" apart from "MangaDex is having a bad day". */
export async function getMangaChaptersWithStatus(
  id: string | number,
): Promise<{ status: "ready" | "unavailable" | "error"; chapters: MangadexMangaChapters[] } | null> {
  const data = await getJson<ChaptersResponse>(`/api/manga/${id}/chapters`);
  if (!data) return { status: "error", chapters: [] };
  return { status: data.status ?? "error", chapters: data.chapters ?? [] };
}

// eslint-disable-next-line import/no-anonymous-default-export
export default {
  // Kept for API compatibility: the reader resolves mangas by AniList id now.
  searchMedia: async ({ query }: { query: string; page?: number }) => {
    try {
      const payload = await getJson<{
        results?: {
          id: number | string;
          title?: string;
          coverImage?: { large?: string; extraLarge?: string };
          tags?: string[];
        }[];
      }>(`/api/anilist/medias?fn=searchCatalog&type=manga&title=${encodeURIComponent(query)}`);

      const data: MangadexMangaSearchResult[] = (payload?.results ?? []).map((item) => ({
        id: String(item.id),
        title: item.title ?? "",
        lastChapter: "",
        lastVolume: "",
        releaseDate: 0,
        headerForImage: { Referer: "" },
        image: item.coverImage?.extraLarge || item.coverImage?.large || "",
        description: "",
        status: "",
      }));

      if (data.length === 0) throw new Error("No results found");
      return data;
    } catch (error) {
      console.error("Mangadex: " + error);
      return undefined;
    }
  },

  // GET MANGA CHAPTERS BY ANILIST ID
  getMangaChapters: async ({ id }: { id: string | number }) => {
    try {
      const data = await getJson<ChaptersResponse>(`/api/manga/${id}/chapters`);
      if (!data || data.status !== "ready") throw new Error("No results found");
      const chapters = data.chapters ?? [];
      if (chapters.length === 0) throw new Error("No results found");
      // sorted ASC by chapter number, the same shape the old backend returned
      return [...chapters].sort(
        (a, b) => Number(a.chapterNumber) - Number(b.chapterNumber),
      );
    } catch (error) {
      console.error(error);
      return null;
    }
  },

  // GET PAGES FOR MANGA CHAPTER
  getChapterPages: async ({ chapterId }: { chapterId: string }) => {
    try {
      const data = await getJson<PagesResponse>(`/api/manga/chapter/${chapterId}`);
      if (!data || data.status !== "ready") throw new Error("No results found");
      const pages = data.pages ?? [];
      if (pages.length === 0) throw new Error("No results found");
      return pages;
    } catch (error) {
      console.error(error);
      return null;
    }
  },
};
