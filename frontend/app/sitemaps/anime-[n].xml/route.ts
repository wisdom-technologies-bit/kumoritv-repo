import { buildMediaSitemap, fetchMediaSlice, getSitemapDb, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

// One page of /media/{id} URLs for imported anime. `discovered_anime` rows that
// were never imported are deliberately absent: they have no page to index.
export async function GET(_request: Request, context: { params: { n: string } }) {
  const page = Math.max(1, Number(context.params.n) || 1);
  const media = await fetchMediaSlice(getSitemapDb(), page);

  return xmlResponse(buildMediaSitemap(media), 3600);
}
