import { requireCron } from "@/app/lib/cron/auth";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { readAdultConfig } from "@/app/lib/watch/adult/config";
import { planSeriesMapping } from "@/app/lib/watch/adult/mapping";
import { fetchAdultSeries } from "@/app/lib/watch/adult/watchhentai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only mapping maintenance for the adult provider, behind the same cron
 * secret as every other admin route.
 *
 *   GET  ?anilistId=900            list what is mapped
 *   POST { anilistId, variant, seriesSlug }            map a whole run
 *   POST { anilistId, episode, variant, videoSlug }    map one episode
 *   DELETE { anilistId, episode?, variant? }           drop mappings
 *
 * Mapping is deliberate: nothing resolves for an adult title until a row here
 * names the source episode. The secret is never echoed back.
 */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;
  const db: any = createAdminClient();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 500 });

  const anilistId = Number(new URL(request.url).searchParams.get("anilistId") || 0);
  const config = readAdultConfig();
  let query = db
    .from("adult_sources")
    .select("anilist_id, episode_number, variant, wh_series_slug, wh_video_slug, matched_title, checked_at")
    .order("anilist_id", { ascending: true })
    .order("episode_number", { ascending: true });
  if (Number.isInteger(anilistId) && anilistId > 0) query = query.eq("anilist_id", anilistId);
  const { data, error } = await query;
  if (error) return Response.json({ error: "query_failed" }, { status: 500 });

  return Response.json(
    {
      providerEnabled: Boolean(config),
      serviceHost: config ? new URL(config.baseUrl).host : null,
      mappings: data ?? [],
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;
  const db: any = createAdminClient();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 500 });
  const config = readAdultConfig();
  if (!config) return Response.json({ error: "adult_provider_disabled" }, { status: 503 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const anilistId = Number(body?.anilistId);
  const variant = body?.variant === "censored" || body?.variant === "uncensored" ? body.variant : null;
  if (!Number.isInteger(anilistId) || anilistId <= 0 || !variant)
    return Response.json({ error: "invalid_request" }, { status: 400 });

  // Single episode.
  if (typeof body?.videoSlug === "string" && body.videoSlug.trim()) {
    const episode = Number(body?.episode);
    if (!Number.isInteger(episode) || episode < 0)
      return Response.json({ error: "invalid_episode" }, { status: 400 });
    const { error } = await db.from("adult_sources").upsert(
      {
        anilist_id: anilistId,
        episode_number: episode,
        variant,
        wh_video_slug: body.videoSlug.trim(),
        wh_series_slug: typeof body?.seriesSlug === "string" ? body.seriesSlug.trim() : "",
        matched_title: typeof body?.title === "string" ? body.title.trim() : null,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "anilist_id,episode_number,variant" },
    );
    if (error) return Response.json({ error: "write_failed" }, { status: 500 });
    return Response.json({ mapped: 1, skipped: [], variant });
  }

  // Whole series.
  if (typeof body?.seriesSlug === "string" && body.seriesSlug.trim()) {
    const seriesSlug = body.seriesSlug.trim();
    const series = await fetchAdultSeries(config, seriesSlug);
    if (!series.ok)
      return Response.json({ error: series.code, message: series.message }, { status: 502 });
    const planned = planSeriesMapping(series.episodes);
    if (planned.length === 0)
      return Response.json({ error: "no_episodes_found" }, { status: 422 });

    const rows = planned.map((item) => ({
      anilist_id: anilistId,
      episode_number: item.episode,
      variant,
      wh_video_slug: item.videoSlug,
      wh_series_slug: seriesSlug,
      matched_title: series.title || item.title || null,
      checked_at: new Date().toISOString(),
    }));
    const { error } = await db
      .from("adult_sources")
      .upsert(rows, { onConflict: "anilist_id,episode_number,variant" });
    if (error) return Response.json({ error: "write_failed" }, { status: 500 });
    return Response.json({
      mapped: rows.length,
      seriesTitle: series.title,
      episodes: rows.map((row) => row.episode_number),
      variant,
    });
  }

  return Response.json({ error: "invalid_request" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;
  const db: any = createAdminClient();
  if (!db) return Response.json({ error: "database_unavailable" }, { status: 500 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const anilistId = Number(body?.anilistId);
  if (!Number.isInteger(anilistId) || anilistId <= 0)
    return Response.json({ error: "invalid_request" }, { status: 400 });

  let query = db.from("adult_sources").delete().eq("anilist_id", anilistId);
  if (Number.isInteger(Number(body?.episode))) query = query.eq("episode_number", Number(body.episode));
  if (body?.variant === "censored" || body?.variant === "uncensored")
    query = query.eq("variant", body.variant);
  const { error } = await query;
  if (error) return Response.json({ error: "delete_failed" }, { status: 500 });
  return Response.json({ deleted: true });
}
