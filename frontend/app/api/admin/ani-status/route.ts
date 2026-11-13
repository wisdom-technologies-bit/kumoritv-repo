import { requireCron } from "@/app/lib/cron/auth";
import { aniStats } from "@/app/lib/ani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only diagnostics for the ani provider.
 *
 * Auth reuses the one admin pattern this repo already has - the cron secret the
 * `/api/cron/*` routes accept (`x-cron-secret: $CRON_SECRET`, or a bearer token).
 * There is no other admin auth in the project, so nothing new was invented here.
 *
 *   curl -H "x-cron-secret: $CRON_SECRET" https://kumoritv.top/api/admin/ani-status
 *
 * It answers with: whether the provider is enabled and configured, the rollout
 * percentage, the breaker state, the 429 pause, cache size, the limiter's budget
 * and concurrency, the last 20 outcomes and the counters
 * (ok / skipped:<reason> / failed:<reason> / fallback_to_anivexa).
 *
 * The key is never part of this payload: only the upstream HOST is reported.
 */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;
  return Response.json(aniStats(), {
    headers: { "cache-control": "no-store" },
  });
}
