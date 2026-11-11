import { createAdminClient } from "@/app/lib/supabase/admin";
import { runCronJob } from "@/app/lib/cron/runner";
import { buildSitemapReport } from "@/lib/sitemap";
import { recentSitemapFailures } from "@/lib/sitemap-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

/**
 * Protected health check: builds the index AND every child in-process and
 * returns one line per file, so the owner can verify all chunks with a single
 * call instead of fetching nineteen XML files by hand.
 *
 *   GET /api/cron/sitemap-check   (header x-cron-secret: $CRON_SECRET)
 *   -> { report: [{ file, status, ms, bytes, urls }, ...], failures, checkedAt }
 *
 * The report is rebuilt from the database, not read from a previous crawl, so
 * the numbers are the real cost of a cold read.
 */
export async function GET(request: Request) {
  return runCronJob({
    request,
    job: "sitemap-check",
    inline: true,
    handler: async () => {
      const db: any = createAdminClient();
      const report = await buildSitemapReport(db, { fresh: true, budgetMs: 180000 });
      return {
        report,
        failures: recentSitemapFailures(),
        checkedAt: new Date().toISOString(),
      };
    },
  });
}
