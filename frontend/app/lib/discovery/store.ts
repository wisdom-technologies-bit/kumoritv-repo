import { createAdminClient } from "@/app/lib/supabase/admin";
export type AnimeRow = { id: number; idMal?: number | null; isAdult?: boolean; format?: string | null; status?: string | null; popularity?: number | null; seasonYear?: number | null; episodes?: number | null; title?: { romaji?: string | null; english?: string | null }; coverImage?: { large?: string | null } };
export function toAnimeRow(m: AnimeRow) { return { anilist_id: m.id, mal_id: m.idMal ?? null, title: m.title?.romaji || m.title?.english || `Anime ${m.id}`, title_english: m.title?.english || null, cover_url: m.coverImage?.large || null, is_adult: Boolean(m.isAdult), format: m.format || null, status: m.status || null, popularity: m.popularity ?? null, season_year: m.seasonYear ?? null, episodes_total: m.episodes ?? null }; }
export async function upsertAnime(rows: AnimeRow[], source: string) { const db: any = createAdminClient(); if (!db || !rows.length) return 0; const mapped = rows.map(toAnimeRow); const ids = mapped.map((r) => r.anilist_id); const { data: existing } = await db.from("discovered_anime").select("anilist_id,sources").in("anilist_id", ids); const sources = new Map((existing || []).map((r: any) => [r.anilist_id, Array.from(new Set([...(r.sources || []), source]))])); const payload = mapped.map((r) => ({ ...r, sources: sources.get(r.anilist_id) || [source] })); const { error } = await db.from("discovered_anime").upsert(payload, { onConflict: "anilist_id" }); if (error) throw error; return payload.length; }
export async function insertEpisodes(rows: any[]) { const db: any = createAdminClient(); if (!db || !rows.length) return 0; let count = 0; for (let i = 0; i < rows.length; i += 500) { const { data, error } = await db.from("airing_episodes").upsert(rows.slice(i, i + 500), { onConflict: "anilist_id,episode", ignoreDuplicates: true }).select("anilist_id"); if (error) throw error; count += data?.length || 0; } return count; }

/**
 * Inserts aired episodes and returns ONLY the rows the table actually kept:
 * `ignoreDuplicates` makes PostgREST return just the newly inserted rows, which is
 * exactly the "newly seen" set the pipeline must queue for a full import.
 */
export async function insertEpisodeRows(rows: any[]): Promise<Array<{ anilist_id: number; episode: number }>> {
  const db: any = createAdminClient();
  if (!db || !rows.length) return [];
  const inserted: Array<{ anilist_id: number; episode: number }> = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db
      .from("airing_episodes")
      .upsert(rows.slice(i, i + 500), { onConflict: "anilist_id,episode", ignoreDuplicates: true })
      .select("anilist_id,episode");
    if (error) throw error;
    for (const row of data || []) {
      const anilist_id = Number(row?.anilist_id);
      const episode = Number(row?.episode);
      if (Number.isInteger(anilist_id) && anilist_id > 0 && Number.isInteger(episode) && episode > 0) {
        inserted.push({ anilist_id, episode });
      }
    }
  }
  return inserted;
}

/**
 * Feeds the sync job. The sync job reads `pending_sync`, retries with backoff and
 * runs importAnime, which is what actually puts episodes into `episodes`. Until
 * this existed nothing ever wrote the table, so the sync and import-queue jobs had
 * nothing to do and new episodes never appeared.
 *
 * Deduplicated on (anilist_id, episode_number) by the unique constraint, so a
 * re-run of the airing job is harmless.
 */
export async function queuePendingSync(
  db: any,
  rows: Array<{ anilist_id: number; episode: number }>,
  options: { skipAnilistIds?: Set<number>; chunkSize?: number } = {},
): Promise<number> {
  if (!db || !rows.length) return 0;
  const skip = options.skipAnilistIds ?? new Set<number>();
  const chunkSize = options.chunkSize ?? 500;

  const seen = new Set<string>();
  const payload: Array<{ anilist_id: number; episode_number: number }> = [];

  for (const row of rows) {
    const anilist_id = Number(row?.anilist_id);
    const episode_number = Number(row?.episode);
    if (!Number.isInteger(anilist_id) || anilist_id <= 0) continue;
    if (!Number.isInteger(episode_number) || episode_number <= 0) continue;
    if (skip.has(anilist_id)) continue;
    const key = `${anilist_id}-${episode_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    payload.push({ anilist_id, episode_number });
  }

  let queued = 0;

  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { data, error } = await db
      .from("pending_sync")
      .upsert(chunk, { onConflict: "anilist_id,episode_number", ignoreDuplicates: true })
      .select("anilist_id");
    if (error) {
      console.warn("[pipeline] pending_sync upsert failed", error.message ?? error);
      continue;
    }
    queued += Array.isArray(data) ? data.length : chunk.length;
  }

  return queued;
}
