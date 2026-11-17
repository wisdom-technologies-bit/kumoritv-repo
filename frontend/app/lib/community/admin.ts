import "server-only";

// Phase 4, part B2: who may write an announcement, decided on the server.
//
// `is_admin()` is a security-definer function over public.staff_roles, which no
// browser role can read. The check runs with the CALLER's session cookie, and
// the write that follows runs with the same client, so the announcements RLS
// policy is a second, independent gate: even a bug in this file cannot let a
// non-admin write a row.

import { createClient } from "@/app/lib/supabase/server";

type AdminCheckClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; is_anonymous?: boolean } | null };
    }>;
  };
  rpc: (name: "is_admin") => Promise<{ data: unknown; error: unknown }>;
};

export type CommunityAdmin = { userId: string };

/** The signed-in admin, or null. Never throws. */
export async function readCommunityAdmin(): Promise<CommunityAdmin | null> {
  try {
    const client = createClient() as unknown as AdminCheckClient | null;
    if (!client) return null;
    const { data } = await client.auth.getUser();
    const user = data?.user;
    if (!user || user.is_anonymous) return null;
    const { data: isAdmin, error } = await client.rpc("is_admin");
    if (error || isAdmin !== true) return null;
    return { userId: user.id };
  } catch {
    return null;
  }
}
