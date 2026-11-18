import { createAdminClient } from "@/app/lib/supabase/admin";
import { listAdultVariants } from "@/app/lib/watch/adult/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/adult/variants?anilistId=<id>&episode=<n>
 *
 * Tells the watch page whether an episode needs a censored/uncensored choice
 * before it asks for a stream. With the provider switched off it answers
 * `providerEnabled: false` and an empty list, so the page behaves as it did.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const anilistId = Number(url.searchParams.get("anilistId"));
  const episode = Number(url.searchParams.get("episode") || "1");
  if (
    !Number.isInteger(anilistId) ||
    anilistId <= 0 ||
    !Number.isInteger(episode) ||
    episode <= 0
  )
    return Response.json({ error: "invalid_request" }, { status: 400 });

  const db: any = createAdminClient();
  if (!db)
    return Response.json({ error: "database_unavailable" }, { status: 500 });

  const result = await listAdultVariants(db, anilistId, episode);
  return Response.json(result, {
    headers: { "cache-control": "private, max-age=60" },
  });
}
