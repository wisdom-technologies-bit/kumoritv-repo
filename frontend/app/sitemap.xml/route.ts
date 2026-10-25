import { createAdminClient } from "@/app/lib/supabase/admin";
import { CHUNK_SIZE, SITE_URL, indexDoc, rows, xmlResponse } from "@/lib/sitemap";
export const revalidate = 900;
export async function GET() { const db = createAdminClient(); const [anime, episodes] = db ? await Promise.all([rows("discovered_anime", "anilist_id,updated_at", "anilist_id"), rows("airing_episodes", "anilist_id,episode,aired_at", "aired_at")]) : [[], []]; const files = [{ loc: `${SITE_URL}/sitemaps/new.xml` }, ...Array.from({ length: Math.ceil(anime.length / CHUNK_SIZE) }, (_, i) => ({ loc: `${SITE_URL}/sitemaps/anime-${i + 1}.xml` })), ...Array.from({ length: Math.ceil(episodes.length / CHUNK_SIZE) }, (_, i) => ({ loc: `${SITE_URL}/sitemaps/episodes-${i + 1}.xml` }))]; return xmlResponse(indexDoc(files), 900); }
