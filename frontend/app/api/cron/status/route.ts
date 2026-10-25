import { createAdminClient } from "@/app/lib/supabase/admin";

export async function GET() {
  const db: any = createAdminClient();
  if (!db) return Response.json({ cron: [] });
  const { data } = await db.from("cron_runs").select("*").order("id", { ascending: false });
  return Response.json({ cron: data ?? [] });
}
