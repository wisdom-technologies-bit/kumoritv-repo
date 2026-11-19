// Test double for "@/app/lib/supabase/auth-server".
export async function createAuthServerClient() {
  return (globalThis as Record<string, unknown>).__fakeServer ?? null;
}
