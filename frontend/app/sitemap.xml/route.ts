import { countRows, getSitemapDb, indexDoc, sitemapIndexFiles, xmlResponse } from "@/lib/sitemap";

export const revalidate = 900;

// The index must list exactly the chunks that exist, so it counts the same two
// sources the chunk routes page through: imported anime, playable episodes.
export async function GET() {
  const db = getSitemapDb();
  const [animeCount, episodeCount] = db
    ? await Promise.all([
        countRows(db, "anime").catch(() => 0),
        countRows(db, "sitemap_episodes").catch(() => 0),
      ])
    : [0, 0];

  return xmlResponse(indexDoc(sitemapIndexFiles(animeCount, episodeCount)), 900);
}
