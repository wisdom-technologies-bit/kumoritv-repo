import { NextResponse } from "next/server";
import { getChaptersByAniListId } from "@/app/lib/manga/mangadex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READY_CACHE = "public, s-maxage=600, stale-while-revalidate=3600";
const ERROR_CACHE = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET(
  _request: Request,
  { params }: { params: { anilistId: string } },
) {
  const anilistId = params?.anilistId ?? "";

  if (!/^\d+$/.test(anilistId) || Number(anilistId) <= 0) {
    return NextResponse.json(
      { status: "error", chapters: [], message: "Invalid AniList id" },
      { status: 400, headers: { "Cache-Control": ERROR_CACHE } },
    );
  }

  try {
    const result = await getChaptersByAniListId(Number(anilistId));

    if (result.status === "error" && !result.title) {
      return NextResponse.json(
        { status: "error", chapters: [], message: "Media not found" },
        { status: 200, headers: { "Cache-Control": ERROR_CACHE } },
      );
    }

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": result.status === "error" ? ERROR_CACHE : READY_CACHE },
    });
  } catch {
    return NextResponse.json(
      { status: "error", chapters: [], message: "MangaDex is unavailable right now" },
      { status: 200, headers: { "Cache-Control": ERROR_CACHE } },
    );
  }
}
