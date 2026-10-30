import { buildEpisodesSitemap, fetchEpisodeSlice, getSitemapDb, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

// One page of /watch/{id}?ep=N URLs. Every URL comes straight from the
// `sitemap_episodes` view, so an episode is listed only when it is stored with a
// provider and its anime exists. No 1..N generation, no AniList guesses.
export async function GET(_request: Request, context: { params: { n: string } }) {
  const page = Math.max(1, Number(context.params.n) || 1);
  const episodes = await fetchEpisodeSlice(getSitemapDb(), page);

  return xmlResponse(buildEpisodesSitemap(episodes), 3600);
}
