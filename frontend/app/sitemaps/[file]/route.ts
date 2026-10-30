import {
  buildEpisodesSitemap,
  buildMediaSitemap,
  fetchEpisodeSlice,
  fetchMediaSlice,
  getSitemapDb,
  parseSitemapFileName,
  xmlResponse,
} from "@/lib/sitemap";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

/**
 * ONE route for every chunked sitemap file: /sitemaps/episodes-1.xml,
 * /sitemaps/anime-1.xml, ...
 *
 * Why a single `[file]` segment: the App Router only treats a folder as dynamic
 * when the WHOLE segment is dynamic (`[n]`). `app/sitemaps/episodes-[n].xml/` is
 * a literal folder name, so the old routes never matched and production returned
 * 404 for /sitemaps/episodes-1.xml. The parameter is parsed here instead, strictly
 * /^(episodes|anime)-(\d+)\.xml$/ - anything else is a 404.
 *
 * Content still comes from the same helpers the old routes called: episodes from
 * the `sitemap_episodes` view (never an invented 1..N range), anime pages from the
 * `anime` table (discovered-but-never-imported rows have no page to index).
 */
export async function GET(_request: Request, context: { params: { file: string } }) {
  const file = parseSitemapFileName(context.params?.file);

  if (!file) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><error>Unknown sitemap file</error>`,
      {
        status: 404,
        headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
      },
    );
  }

  const db = getSitemapDb();

  if (file.kind === "episodes") {
    const episodes = await fetchEpisodeSlice(db, file.page);
    return xmlResponse(buildEpisodesSitemap(episodes), 3600);
  }

  const media = await fetchMediaSlice(db, file.page);
  return xmlResponse(buildMediaSitemap(media), 3600);
}
