import { buildRecentSitemapPayload, formatError } from "@/lib/sitemap";
import { loadSitemap, sitemapErrorResponse, sitemapHttpResult } from "@/lib/sitemap-cache";

export const runtime = "nodejs";
export const revalidate = 600;

// Last 72h by air_date: playable episodes get a watch URL (priority 0.9, changefreq always);
// just-aired episodes we have not imported yet contribute only their media URL.
const KEY = "sitemap:new";

export async function GET(request: Request) {
  const started = Date.now();
  try {
    const served = await loadSitemap(KEY, () => buildRecentSitemapPayload());
    return sitemapHttpResult(served, request);
  } catch (error) {
    console.error(
      `[sitemap] new.xml failed step=serve elapsed_ms=${Date.now() - started} error=${
        formatError(error)
      }`,
    );
    return sitemapErrorResponse(503, "Sitemap temporarily unavailable", { "Retry-After": "3600" });
  }
}
