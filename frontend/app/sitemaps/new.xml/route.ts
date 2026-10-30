import {
  buildRecentSitemap,
  fetchRecentEpisodes,
  getSitemapDb,
  recentAiringTopUp,
  xmlResponse,
} from "@/lib/sitemap";

export const dynamic = "force-dynamic";
export const revalidate = 600;

// Last 48h: playable episodes get a watch URL (priority 0.9, changefreq always);
// just-aired episodes we have not imported yet contribute only their media URL.
export async function GET() {
  const db = getSitemapDb();
  const [episodes, topUp] = await Promise.all([
    fetchRecentEpisodes(db, 48).catch(() => []),
    recentAiringTopUp(),
  ]);

  return xmlResponse(buildRecentSitemap(episodes, topUp), 600);
}
