// Prompt 33 Part B - GET /api/schedule/ics?ids=1,2,3&days=14
//
// A subscribable calendar for the viewer's own list: one VEVENT per episode
// airing in the next `days` days, with a 15 minute reminder. Ids are validated
// (max 50) and the AniList window goes through the same cached feed the page
// uses, so this route never multiplies upstream traffic.
import { NextResponse } from "next/server";
import { getAiringSchedule } from "@/app/lib/anilist/medias.server";
import { buildIcs, parseDaysParam, parseIdsParam } from "@/app/lib/schedule/ics";
import { originFromHeaders } from "@/app/lib/siteOrigin";
import { absoluteUrl } from "@/app/lib/seo/text";

export const revalidate = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids = parseIdsParam(url.searchParams.get("ids"));
  const days = parseDaysParam(url.searchParams.get("days"), 14);

  if (!ids.length) {
    return NextResponse.json(
      { error: "Pass up to 50 anime ids, for example ?ids=21,16498&days=14" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const wanted = new Set(ids);
  const schedule = await getAiringSchedule({ from: nowUnix - 1800, to: nowUnix + days * 86_400 });

  // One window, filtered to the ids the viewer asked for.
  const items = schedule.items.filter((item) => wanted.has(item.media.id));
  const calendar = buildIcs({
    items,
    siteUrl: originFromHeaders(request.headers, absoluteUrl("/")),
    nowUnixSeconds: nowUnix,
    calendarName: "KumoriTV - my list",
    days,
  });

  return new NextResponse(calendar, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kumoritv-my-list.ics"',
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}
