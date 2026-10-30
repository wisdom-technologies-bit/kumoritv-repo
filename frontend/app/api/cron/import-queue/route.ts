import { importAnime } from "@/app/lib/anime-db/import";
import { runImportQueue } from "@/app/lib/anime-db/import-queue";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { runCronJob, retryDelayMs, chainSelf } from "@/app/lib/cron/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

/**
 * Drains `anime_import_queue`.
 *
 * The loop lives in app/lib/anime-db/import-queue.ts so it can be tested: one
 * import per anilist_id per run, a no-progress stop, checked writes, a circuit
 * breaker and a 150-import cap per run. See that file for the production hot loop
 * this replaces (6081 claimed rows against a 5-row table).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const batch = Math.min(25, Math.max(1, Number(params.get("batch") || 8)));

  return runCronJob({
    request,
    job: "import-queue",
    handler: async (ctx) => {
      const db: any = createAdminClient();
      if (!db) throw new Error("supabase_not_configured");

      const stats = await runImportQueue({
        db,
        batch,
        deadline: ctx.deadline,
        retryDelayMs,
        importOne: (id, row) =>
          importAnime(id, {
            source: "queue",
            snapshot: row?.snapshot,
            timeoutMs: 45000,
            refreshMetadata: false,
          }),
      });

      const { count } = await db.from("anime_import_queue").select("anilist_id", { count: "exact", head: true }).eq("status", "pending");

      const summary = {
        ...stats,
        remainingPending: count || 0,
        tookMs: Date.now() - ctx.startedAt,
      };

      console.log("[import-queue] run", JSON.stringify(summary));

      // Chain only when progress is still possible: an open circuit must not keep
      // waking itself up against a failing upstream.
      if (summary.remainingPending && stats.stopped !== "circuit_open" && stats.imported > 0) {
        chainSelf(request);
      }

      return summary;
    },
  });
}
