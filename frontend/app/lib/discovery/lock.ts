import { createAdminClient } from "@/app/lib/supabase/admin";

export async function acquireLock(job: string, minutes: number) {
  const db: any = createAdminClient();
  if (!db) throw new Error("supabase_not_configured");
  const { data, error } = await db.from("cron_runs").update({ locked_until: new Date(Date.now() + minutes * 60000).toISOString(), last_started_at: new Date().toISOString() }).eq("job", job).or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`).select("job").maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return true;
}
export async function finishRun(job: string, result: { ok: boolean; stats?: unknown; error?: string | null; windowEnd?: string | null }) {
  const db: any = createAdminClient(); if (!db) return;
  const now = new Date().toISOString();
  await db.from("cron_runs").update({ last_finished_at: now, last_success_at: result.ok ? now : undefined, last_window_end: result.windowEnd ?? undefined, last_stats: result.stats ?? {}, last_error: result.error ?? null, locked_until: null }).eq("job", job);
}
