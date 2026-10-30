import { STATIC_SITEMAP_PAGES, buildStaticSitemap, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-static";
export const revalidate = 3600;

// The fixed public pages that exist AND are indexable: /, /search and
// /search?type=manga. /privacy and /terms are intentionally absent (their page
// metadata is `robots: { index: false }`), as are /favourites, /my-lists, /auth
// and the API routes. See STATIC_SITEMAP_PAGES in lib/sitemap.ts.
export async function GET() {
  return xmlResponse(buildStaticSitemap(STATIC_SITEMAP_PAGES), 3600);
}
