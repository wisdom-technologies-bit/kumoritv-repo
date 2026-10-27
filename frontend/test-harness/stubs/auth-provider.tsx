// Test double for the Supabase auth context: the test installs the session.
type TestUser = { id: string; is_anonymous?: boolean; user_metadata?: Record<string, unknown> } | null;

export function useUser() {
  return (
    (globalThis as Record<string, unknown>).__commentsTestAuth ?? {
      user: null as TestUser,
      profile: null,
      isAnonymous: false,
      loading: false,
      signOut: async () => {},
    }
  );
}
