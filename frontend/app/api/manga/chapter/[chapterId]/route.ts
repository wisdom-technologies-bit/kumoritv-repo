import { NextResponse } from "next/server";
import { getChapterPages } from "@/app/lib/manga/mangadex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Node URLs expire, so they are only cached for a minute.
const PAGES_CACHE = "public, s-maxage=60, stale-while-revalidate=120";
const ERROR_CACHE = "public, s-maxage=30, stale-while-revalidate=120";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: { chapterId: string } },
) {
  const chapterId = params?.chapterId ?? "";

  if (!UUID.test(chapterId)) {
    return NextResponse.json(
      { status: "error", pages: [], message: "Invalid chapter id" },
      { status: 400, headers: { "Cache-Control": ERROR_CACHE } },
    );
  }

  try {
    const pages = await getChapterPages(chapterId);

    if (pages.length === 0) {
      return NextResponse.json(
        { status: "unavailable", pages: [] },
        { status: 200, headers: { "Cache-Control": ERROR_CACHE } },
      );
    }

    return NextResponse.json({ status: "ready", pages }, { status: 200, headers: { "Cache-Control": PAGES_CACHE } });
  } catch (error) {
    const status = (error as { status?: number })?.status === 404 ? "unavailable" : "error";
    return NextResponse.json(
      { status, pages: [], message: "These pages could not be loaded" },
      { status: 200, headers: { "Cache-Control": ERROR_CACHE } },
    );
  }
}
