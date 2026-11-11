import { buildStaticSitemapPayload, formatError } from "@/lib/sitemap";
import { loadSitemap, sitemapErrorResponse, sitemapHttpResult } from "@/lib/sitemap-cache";

export const runtime = "nodejs";
export const revalidate = 3600;

// The fixed public pages that exist AND are indexable: /, /search and
// /search?type=manga. /privacy and /terms are intentionally absent (their page
// metadata is `robots: { index: false }`), as are /favourites, /my-lists, /auth
// and the API routes. See STATIC_SITEMAP_PAGES in lib/sitemap.ts.
const KEY = "sitemap:static";

export async function GET(request: Request) {
  try {
    const served = await loadSitemap(KEY, async () => buildStaticSitemapPayload());
    return sitemapHttpResult(served, request);
  } catch (error) {
    console.error(
      `[sitemap] static.xml failed step=serve error=${formatError(error)}`,
    );
    return sitemapErrorResponse(503, "Sitemap temporarily unavailable", { "Retry-After": "3600" });
  }
}
