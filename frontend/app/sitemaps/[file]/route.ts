import { buildChunkSitemap, parseSitemapFileName, formatError } from "@/lib/sitemap";
import { loadSitemap, sitemapErrorResponse, sitemapHttpResult } from "@/lib/sitemap-cache";

export const runtime = "nodejs";
/**
 * Prompt 34: no more `force-dynamic`. Every crawler hit used to re-walk the
 * database (ten or more sequential queries for one chunk). The file is now
 * cached per name by `unstable_cache` (tag `sitemap`, revalidate 3600) and by
 * the in-process cache in lib/sitemap-cache, and Cloudflare may cache it too -
 * see docs/sitemap-cloudflare.md.
 */
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
 * Answers:
 *   200 + the XML (ETag, Last-Modified, s-maxage)   - the normal case
 *   304                                             - the crawler already has it
 *   404                                             - no such chunk, or a chunk
 *                                                     with no rows (episodes-15..19
 *                                                     used to answer 200 with an
 *                                                     empty urlset)
 *   503 + Retry-After                               - the build failed and there is
 *                                                     no cached copy to serve
 */
export async function GET(request: Request, context: { params: { file: string } }) {
  const started = Date.now();
  const file = parseSitemapFileName(context.params?.file);

  if (!file) {
    return sitemapErrorResponse(404, "Unknown sitemap file");
  }

  const key = `sitemap:${file.kind}:${file.page}`;

  try {
    const served = await loadSitemap(key, () => buildChunkSitemap(file));

    if (served.payload.empty) {
      // A chunk past the end of the data: 404, never a 200 with an empty urlset.
      console.warn(
        `[sitemap] empty chunk file=${file.kind}-${file.page}.xml step=build elapsed_ms=${
          Date.now() - started
        } - answering 404`,
      );
      return sitemapErrorResponse(404, "No rows for this sitemap chunk");
    }

    return sitemapHttpResult(served, request);
  } catch (error) {
    console.error(
      `[sitemap] chunk failed file=${file.kind}-${file.page}.xml page=${file.page} step=serve elapsed_ms=${
        Date.now() - started
      } error=${formatError(error)}`,
    );
    return sitemapErrorResponse(503, "Sitemap temporarily unavailable", { "Retry-After": "3600" });
  }
}
