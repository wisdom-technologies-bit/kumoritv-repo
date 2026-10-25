import { createAdminClient } from "@/app/lib/supabase/admin";
import { fetchAiringWindow } from "@/app/lib/discovery/anilist";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://kumoritv.vercel.app").replace(/\/$/, "");
export const CHUNK_SIZE = 40000;
export const xmlEscape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export const watchUrl = (id: number, episode: number) => `${SITE_URL}/watch/${id}?ep=${episode}`;
export const mediaUrl = (id: number) => `${SITE_URL}/media/${id}`;
export const xmlResponse = (body: string, seconds: number, type = "application/xml") => new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate` } });
export async function rows(table: string, columns: string, order: string, predicate?: (query: any) => any) {
  const db = createAdminClient(); if (!db) return [] as any[];
  const output: any[] = [];
  for (let from = 0; ; from += 1000) {
    let query: any = db.from(table).select(columns).order(order, { ascending: false }).range(from, from + 999);
    if (predicate) query = predicate(query);
    const { data, error } = await query; if (error) throw error;
    output.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  return output;
}
export function sitemapUrl(loc: string, lastmod?: string, changefreq?: string, priority?: string) { return `<url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${xmlEscape(lastmod)}</lastmod>` : ""}${changefreq ? `<changefreq>${changefreq}</changefreq>` : ""}${priority ? `<priority>${priority}</priority>` : ""}</url>`; }
export function sitemapDoc(urls: string[]) { return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`; }
export function indexDoc(files: Array<{ loc: string; lastmod?: string }>) { return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map((file) => `<sitemap><loc>${xmlEscape(file.loc)}</loc>${file.lastmod ? `<lastmod>${xmlEscape(file.lastmod)}</lastmod>` : ""}</sitemap>`).join("")}</sitemapindex>`; }
export async function recentAiringTopUp() {
  try { const page = await fetchAiringWindow(Math.floor(Date.now() / 1000) - 21600, Math.floor(Date.now() / 1000), 1); return (page.airingSchedules || []).filter((item: any) => item.airingAt <= Date.now() / 1000); } catch { return []; }
}
export const chunks = <T,>(items: T[], size = CHUNK_SIZE) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
