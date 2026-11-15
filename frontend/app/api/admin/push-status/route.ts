import { existsSync } from "node:fs";
import { join } from "node:path";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { requireCron } from "@/app/lib/cron/auth";
import { PUSH_WORKER_PATH } from "@/app/lib/push/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/push-status  (header x-cron-secret: $CRON_SECRET)
 *
 * One object that answers "why is nothing arriving". No secrets: the app id and
 * the REST key are reported as present/absent only, never as values.
 */
const countOf = async (db: any, status: string) => {
  try {
    const { count } = await db
      .from("push_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    return Number(count) || 0;
  } catch {
    return 0;
  }
};

export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;

  const db: any = createAdminClient();
  const root = process.cwd();
  const workerUrlOk =
    existsSync(join(root, "public", PUSH_WORKER_PATH)) &&
    existsSync(join(root, "public", "push/onesignal/OneSignalSDKUpdaterWorker.js"));

  const payload: Record<string, unknown> = {
    appIdPresent: Boolean((process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || "").trim()),
    restKeyPresent: Boolean((process.env.ONESIGNAL_REST_API_KEY || "").trim()),
    workerUrlOk,
    workerPath: `/${PUSH_WORKER_PATH}`,
    workerScope: "/push/onesignal/",
    outbox: { pending: 0, sent: 0, failed: 0, lastError: null, lastSentAt: null },
    lastCronRunAt: null,
    subscribedUsers: 0,
  };

  if (!db) return Response.json({ ...payload, error: "supabase_unavailable" });

  try {
    const [pending, sent, failed] = await Promise.all([
      countOf(db, "pending"),
      countOf(db, "sent"),
      countOf(db, "failed"),
    ]);
    const { data: lastFailed } = await db
      .from("push_outbox")
      .select("error, attempts")
      .eq("status", "failed")
      .order("id", { ascending: false })
      .limit(1);
    const { data: lastSent } = await db
      .from("push_outbox")
      .select("sent_at")
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1);
    const { data: cron } = await db
      .from("cron_runs")
      .select("finished_at, ok")
      .eq("job", "push")
      .order("id", { ascending: false })
      .limit(1);
    const { count: subscribed } = await db
      .from("push_preferences")
      .select("user_id", { count: "exact", head: true })
      .eq("enabled", true);

    payload.outbox = {
      pending,
      sent,
      failed,
      lastError: (lastFailed as any[] | null)?.[0]?.error ?? null,
      lastSentAt: (lastSent as any[] | null)?.[0]?.sent_at ?? null,
    };
    payload.lastCronRunAt = (cron as any[] | null)?.[0]?.finished_at ?? null;
    payload.subscribedUsers = Number(subscribed) || 0;
  } catch {
    /* tables missing is itself diagnostic: the zeros stay and say so */
  }

  return Response.json(payload, { headers: { "cache-control": "no-store" } });
}
