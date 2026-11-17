import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type AdminClientOptions = {
  /**
   * Opt this client out of Next's Data Cache.
   *
   * Route handlers run inside Next's patched `fetch`, which can store a
   * response on disk under `.next/cache/fetch-cache` and replay it on a later
   * request. For a "what appeared just now" read that replay is fatal: the
   * handler runs, the caller gets yesterday's rows. `no-store` keeps the read
   * going to Postgres every time the route's own short cache says it may.
   */
  noStore?: boolean;
};

export function createAdminClient(options: AdminClientOptions = {}): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.warn("Supabase admin client unavailable: missing environment variables"); return null; }
  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(options.noStore
      ? {
          global: {
            fetch: (input: RequestInfo | URL, init?: RequestInit) =>
              fetch(input, { ...init, cache: "no-store" as RequestCache }),
          },
        }
      : {}),
  });
}
