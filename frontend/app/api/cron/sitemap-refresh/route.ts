import { createAdminClient } from "@/app/lib/supabase/admin";
import { runCronJob, type CronContext } from "@/app/lib/cron/runner";
import { buildSitemapReport } from "@/lib/sitemap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

/**
 * Refreshes `public.sitemap_episodes_ranked` and then pre-warms every sitemap
 * file into the in-process cache, so a crawler normally reads a warm file.
 *
 * Schedule: every 30 minutes (cron-job.org entry documented in
 * docs/sitemap-cloudflare.md):
 *   GET https://kumoritv.top/api/cron/sitemap-refresh
 *   header: x-cron-secret: $CRON_SECRET
 *   ?wait=1 to get the JSON report instead of 202
 *
 * Railway note: this is a long-running Node process, so the in-process cache
 * survives between requests. Nothing here depends on Vercel - `maxDuration` is
 * read by the Next.js server build and the work is bounded by the cron budget
 * below.
 */
export async function GET(request: Request) {
  return runCronJob({
    request,
    job: "sitemap-refresh",
    inline: new URL(request.url).searchParams.get("wait") !== "0",
    handler: async (ctx: CronContext) => {
      const started = Date.now();
      const db: any = createAdminClient();

      let refreshed: string | null = null;
      let refreshError: string | null = null;

      if (db) {
        // The SQL function tries REFRESH ... CONCURRENTLY first and falls back
        // to a plain refresh (PostgREST runs inside a transaction) - see
        // docs/sql/sitemap-chunks.sql.
        const { data, error } = await db.rpc("refresh_sitemap_episodes");
        if (error) {
          refreshError = error.message || String(error);
          console.error(
            `[sitemap] refresh failed step=rpc elapsed_ms=${Date.now() - started} error=${refreshError}`,
          );
        } else {
          refreshed = typeof data === "string" ? data : "ok";
        }
      } else {
        refreshError = "supabase admin client unavailable";
      }

      // Pre-warm whatever is left of the budget: the refresh itself is the part
      // that must not be skipped, warming is an optimisation.
      const report = await buildSitemapReport(db, {
        fresh: true,
        budgetMs: Math.max(5000, ctx.budgetMs - (Date.now() - started) - 15000),
      });

      const stats = {
        refreshed,
        refreshError,
        files: report.length,
        ok: report.filter((row) => row.status === 200).length,
        missing: report.filter((row) => row.status === 404).length,
        failed: report.filter((row) => row.status === 503).length,
        elapsedMs: Date.now() - started,
      };
      console.log(`[sitemap] refresh ${JSON.stringify(stats)}`);
      return stats;
    },
  });
}
