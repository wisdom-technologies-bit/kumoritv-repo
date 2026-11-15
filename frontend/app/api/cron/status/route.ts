import { createAdminClient } from "@/app/lib/supabase/admin";
import { sitemapHealth } from "@/lib/sitemap";

/**
 * Admin status. `sitemap` answers the question the XML cannot: is the ranked
 * view still in step with the live catalogue? Cheap because it is cached for a
 * minute in-process, and the counts are not secret.
 */
let cachedHealth: { at: number; value: unknown } | null = null;
const HEALTH_TTL_MS = 60_000;

export const dynamic = "force-dynamic";

export async function GET() {
  const db: any = createAdminClient();
  if (!db) return Response.json({ cron: [], sitemap: null });
  const { data } = await db.from("cron_runs").select("*").order("id", { ascending: false });

  let sitemap: unknown = cachedHealth?.value ?? null;
  if (!cachedHealth || Date.now() - cachedHealth.at >= HEALTH_TTL_MS) {
    try {
      sitemap = await sitemapHealth(db);
      cachedHealth = { at: Date.now(), value: sitemap };
    } catch {
      /* keep the last answer rather than failing the endpoint */
    }
  }

  return Response.json({ cron: data ?? [], sitemap }, {
    headers: { "cache-control": "no-store" },
  });
}
