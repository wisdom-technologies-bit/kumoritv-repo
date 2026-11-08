import { createAdminClient } from "@/app/lib/supabase/admin";
import { chainSelf, runCronJob } from "@/app/lib/cron/runner";
import { processLogoCandidates, type LogoStats } from "@/app/lib/tmdb/fill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

// Fills `anime.logo_path` (+ aspect ratio / width) from TMDB, one small batch at
// a time. Same auth, bookkeeping and chaining as the other cron jobs: 401 without
// credentials, 202 when the work runs in the background.
//
// Query params:
//   batch=40      rows per run (1-100)
//   force=1       re-check rows that were already looked at
//   anilist_id=N  process just that row (testing)
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requested = Number(params.get("batch") || 40);
  const batch = Math.min(100, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 40));
  const force = params.get("force") === "1";
  const anilistParam = Number(params.get("anilist_id"));
  const anilistId = Number.isInteger(anilistParam) && anilistParam > 0 ? anilistParam : null;

  return runCronJob({
    request,
    job: "logos",
    handler: async (ctx): Promise<LogoStats> => {
      const db = createAdminClient();

      if (!db) {
        return {
          claimed: 0,
          found: 0,
          none: 0,
          errors: 0,
          skipped: 0,
          rateLimited: false,
          remaining: 0,
        };
      }

      const stats = await processLogoCandidates({
        db,
        batch,
        force,
        anilistId,
        deadline: ctx.deadline,
      });

      if (stats.remaining > 0 && !stats.rateLimited && !anilistId) chainSelf(request);

      return stats;
    },
  });
}
