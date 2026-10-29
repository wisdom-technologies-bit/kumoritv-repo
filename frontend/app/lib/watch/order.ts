import { createAdminClient } from "@/app/lib/supabase/admin";

export const PROVIDER_PRIORITY = [
  "anikoto",
  "aniwaves",
  "kaa",
  "animegg",
  "anipm",
  "senshi",
  "mkissa",
  "reanime",
  // Probed later: kept after the known-good providers on purpose.
  "animenosub",
  "anizone",
];

type Health = { fail_count: number; window_started_at: string };
let healthCache: { at: number; values: Map<string, Health> } | null = null;

export function providerRank(name: string) {
  const index = PROVIDER_PRIORITY.indexOf(name);
  return index < 0 ? PROVIDER_PRIORITY.length : index;
}

export async function getProviderHealth() {
  if (healthCache && Date.now() - healthCache.at < 60_000)
    return healthCache.values;
  const values = new Map<string, Health>();
  const db: any = createAdminClient();
  if (db) {
    const { data } = await db
      .from("provider_health")
      .select("provider, fail_count, window_started_at");
    for (const row of data || []) {
      if (Date.now() - new Date(row.window_started_at).getTime() < 1_800_000)
        values.set(row.provider, row);
    }
  }
  healthCache = { at: Date.now(), values };
  return values;
}

export async function rankProviders<
  T extends { provider?: string; id?: string },
>(providers: T[]) {
  const health = await getProviderHealth();
  return [...providers].sort((a, b) => {
    const aName = a.provider || a.id || "";
    const bName = b.provider || b.id || "";
    const aUnhealthy = (health.get(aName)?.fail_count || 0) >= 5;
    const bUnhealthy = (health.get(bName)?.fail_count || 0) >= 5;
    return (
      Number(aUnhealthy) - Number(bUnhealthy) ||
      providerRank(aName) - providerRank(bName)
    );
  });
}
