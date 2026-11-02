// Test double for the server-side episode SEO gatherer.
//
// The watch page imports `getEpisodeSeo` statically; tests install a fixed
// EpisodeSeo on `globalThis.__episodeSeo` so a rendered page can be checked
// without a live Supabase project (the real client needs a native WebSocket).
export function getEpisodeSeo() {
  const seo = (globalThis as { __episodeSeo?: unknown }).__episodeSeo;
  if (!seo) throw new Error("no __episodeSeo installed for this test");
  return Promise.resolve(seo);
}
