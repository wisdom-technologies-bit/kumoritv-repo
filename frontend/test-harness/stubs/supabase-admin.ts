// Test double for "@/app/lib/supabase/admin": the route only needs whatever the
// test put on globalThis.__fakeAdmin.
export function createAdminClient() {
  return (globalThis as Record<string, unknown>).__fakeAdmin ?? null;
}
