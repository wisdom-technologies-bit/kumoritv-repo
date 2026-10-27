// Test double: the client is whatever the running test installed on globalThis.
export function createBrowserSupabaseClient() {
  return (globalThis as Record<string, unknown>).__commentsTestClient ?? null;
}
