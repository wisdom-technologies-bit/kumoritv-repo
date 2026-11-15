import { createAdminClient } from "@/app/lib/supabase/admin";
import { lookupMalId } from "@/app/lib/ani";
import {
  downloadAd,
  downloadsEnabled,
  getEpisodeDownloads,
  type DownloadsPayload,
} from "@/app/lib/downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/downloads?anilistId=<id>&episode=<n>
 *
 * The browser's only view of the download links. It resolves the MAL id exactly
 * as the ani provider does (`anime.mal_id`, same lookup) and asks the ani-api on
 * the server, so the key never leaves the server. Nothing changes on deploy:
 * `DOWNLOADS_ENABLED` is off by default and the answer is then `disabled:true`,
 * which the watch page renders as "no button at all".
 */

const hits = new Map<string, number[]>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=30",
      "x-content-type-options": "nosniff",
    },
  });

function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const anilistId = Number(url.searchParams.get("anilistId"));
  const episode = Number(url.searchParams.get("episode"));

  if (!Number.isInteger(anilistId) || anilistId <= 0 || anilistId > 1e9)
    return json({ error: "invalid_anilist_id" }, 400);
  if (!Number.isInteger(episode) || episode < 1 || episode > 10000)
    return json({ error: "invalid_episode" }, 400);

  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) return json({ error: "rate_limited" }, 429);

  const disabledPayload: DownloadsPayload = {
    available: false,
    provider: null,
    groups: [],
    note: null,
    disabled: true,
  };
  if (!downloadsEnabled()) return json(disabledPayload);

  const db: any = createAdminClient();
  const malId = db ? await lookupMalId(db, anilistId) : null;
  if (!malId)
    return json({
      available: false,
      provider: null,
      groups: [],
      note: "This title has no download page yet.",
    } satisfies DownloadsPayload);

  try {
    const { payload } = await getEpisodeDownloads({ malId, episode });
    const ad = downloadAd();
    return json({ ...payload, ...(ad ? { ad } : {}) });
  } catch {
    // Never an upstream error body, never a stack, never the key.
    return json({
      available: false,
      provider: null,
      groups: [],
      note: "Download links are unavailable right now.",
    } satisfies DownloadsPayload);
  }
}
