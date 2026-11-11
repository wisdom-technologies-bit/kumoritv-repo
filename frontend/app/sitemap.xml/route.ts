import { buildSitemapIndexPayload, formatError } from "@/lib/sitemap";
import { loadSitemap, sitemapErrorResponse, sitemapHttpResult } from "@/lib/sitemap-cache";

export const runtime = "nodejs";
export const revalidate = 3600;

/**
 * The index must list exactly the chunks that exist, so it reads the same data
 * the chunk routes page through: `max(rn)` on the ranked view for episodes
 * (never `count: 'exact'` on the heavy view, which timed out and silently listed
 * the wrong number of chunks), the anime count for media pages.
 *
 * Prompt 34: cached like every other file, a per-chunk <lastmod> when it is
 * cheap, 503 + Retry-After instead of a bare 500 when the build fails.
 */
const KEY = "sitemap:index";

export async function GET(request: Request) {
  const started = Date.now();
  try {
    const served = await loadSitemap(KEY, () => buildSitemapIndexPayload());
    return sitemapHttpResult(served, request);
  } catch (error) {
    console.error(
      `[sitemap] index failed step=serve elapsed_ms=${Date.now() - started} error=${
        formatError(error)
      }`,
    );
    return sitemapErrorResponse(503, "Sitemap index temporarily unavailable", { "Retry-After": "3600" });
  }
}
