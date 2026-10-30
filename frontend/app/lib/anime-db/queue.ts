import "server-only";
import { createAdminClient } from "@/app/lib/supabase/admin";
import { needsImport } from "./import";
export function toSnapshot(media:any){return {title:{english:media.title?.english||null,romaji:media.title?.romaji||null,native:media.title?.native||null},description:media.description||null,coverImage:media.coverImage||null,bannerImage:media.bannerImage||null,format:media.format||null,status:media.status||null,season:media.season||null,seasonYear:media.seasonYear||null,episodes:media.episodes??null,duration:media.duration??null,genres:media.genres||[],averageScore:media.averageScore??null,isAdult:!!media.isAdult,idMal:media.idMal??null};}
export async function enqueueAnime(items:any[],reason:string,priority:number,dbArg?:any){try{const db:any=dbArg??createAdminClient();if(!db)return 0;const unique=[...new Map(items.filter((m)=>m?.id&&!m.isAdult).map((m)=>[Number(m.id),m])).values()].slice(0,50);const ids=unique.map((m:any)=>Number(m.id));const {data:rows}=await db.from("anime").select("*").in("anilist_id",ids);const existing=new Map((rows||[]).map((r:any)=>[r.anilist_id,r]));const pending=unique.filter((m:any)=>needsImport(existing.get(Number(m.id))||null)).map((m:any)=>({anilist_id:Number(m.id),snapshot:toSnapshot(m)}));if(!pending.length)return 0;const {data,error}=await db.rpc("enqueue_anime",{items:pending,p_reason:reason,p_priority:priority});if(error)throw error;return Number(data)||pending.length;}catch(error){console.warn("enqueueAnime failed",error);return 0;}}

/**
 * Enqueues discovered anime that have no `anime` row yet.
 *
 * This is the second half of the pipeline fix: `enqueueAnime` existed but nothing
 * called it, so `anime_import_queue` stayed empty and the import-queue job had
 * nothing to import. Non-adult titles only, most popular first, capped per run, and
 * handed to `enqueueAnime` in chunks of 50 (it slices to 50 by itself).
 */
export const ENQUEUE_CHUNK_SIZE = 50;
export const ENQUEUE_MAX_PER_RUN = 200;

export async function enqueueMissingAnime(
  items: any[],
  reason: string,
  priority: number,
  options: { max?: number; db?: any } = {},
): Promise<number> {
  try {
    const db: any = options.db ?? createAdminClient();
    if (!db || !Array.isArray(items) || !items.length) return 0;

    const max = Math.max(1, options.max ?? ENQUEUE_MAX_PER_RUN);

    const unique = [
      ...new Map(
        items
          .filter((media) => media?.id && !media.isAdult)
          .map((media) => [Number(media.id), media]),
      ).values(),
    ]
      .filter((media: any) => Number.isInteger(Number(media.id)) && Number(media.id) > 0)
      // Most popular first: those are the pages people actually look for.
      .sort((left: any, right: any) => (Number(right.popularity) || 0) - (Number(left.popularity) || 0))
      .slice(0, max);

    if (!unique.length) return 0;

    const ids = unique.map((media: any) => Number(media.id));
    const existing = new Set<number>();

    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await db.from("anime").select("anilist_id").in("anilist_id", ids.slice(i, i + 500));
      if (error) {
        console.warn("[pipeline] anime lookup failed", error.message ?? error);
        continue;
      }
      for (const row of data || []) existing.add(Number(row.anilist_id));
    }

    const missing = unique.filter((media: any) => !existing.has(Number(media.id)));
    if (!missing.length) return 0;

    let enqueued = 0;

    for (let i = 0; i < missing.length; i += ENQUEUE_CHUNK_SIZE) {
      enqueued += await enqueueAnime(missing.slice(i, i + ENQUEUE_CHUNK_SIZE), reason, priority, db);
    }

    return enqueued;
  } catch (error) {
    console.warn("[pipeline] enqueueMissingAnime failed", error instanceof Error ? error.message : error);
    return 0;
  }
}
