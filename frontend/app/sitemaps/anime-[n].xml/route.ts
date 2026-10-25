import { rows, sitemapDoc, sitemapUrl, mediaUrl, xmlResponse } from "@/app/lib/sitemap";
export const revalidate = 3600;
export async function GET(_request: Request, context: { params: { n: string } }) { const page = Math.max(1, Number(context.params.n) || 1); const data = await rows("discovered_anime", "anilist_id,updated_at", "anilist_id"); const slice = data.slice((page - 1) * 40000, page * 40000); return xmlResponse(sitemapDoc(slice.map((row: any) => sitemapUrl(mediaUrl(row.anilist_id), row.updated_at, undefined, "0.7"))), 3600); }
