import { createAdminClient } from "@/app/lib/supabase/admin";
import { getMediaInfo } from "@/app/lib/anilist/medias.server";
import {
  normaliseImageRequests,
  resolveImages,
  type ImageDeps,
} from "@/app/lib/episodes/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): ImageDeps {
  const db: any = createAdminClient();
  return {
    async readEpisodeImages(ids) {
      if (!db) return [];
      const { data } = await db
        .from("episodes")
        .select("anilist_id,episode_number,image_url")
        .in("anilist_id", ids);
      return Array.isArray(data) ? data : [];
    },
    async readAnimeCovers(ids) {
      if (!db) return [];
      const { data } = await db
        .from("anime")
        .select("anilist_id,cover_url")
        .in("anilist_id", ids);
      return Array.isArray(data) ? data : [];
    },
    async readAniListCover(anilistId) {
      const media: any = await getMediaInfo({ id: anilistId });
      return (
        media?.coverImage?.extraLarge || media?.coverImage?.large || null
      );
    },
  };
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return Response.json({ images: {} });
  }
  const requests = normaliseImageRequests(
    (body as any)?.items ?? (body as any)?.pairs,
  );
  if (!requests.length) return Response.json({ images: {} });
  const images = await resolveImages(requests, deps());
  return Response.json(
    { images },
    { headers: { "cache-control": "private, max-age=300" } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pairs = (url.searchParams.get("items") || "")
    .split(",")
    .map((pair) => pair.split("-"))
    .map(([anilistId, episode]) => ({ anilistId, episode }));
  return POST(
    new Request(request.url, {
      method: "POST",
      body: JSON.stringify({ items: pairs }),
      headers: { "content-type": "application/json" },
    }),
  );
}
