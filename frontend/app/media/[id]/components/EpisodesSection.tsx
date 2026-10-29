import { getAnimeWithEpisodes, importAnime, needsImport } from "@/app/lib/anime-db/import";
import { mapEpisodeRows } from "@/app/lib/episodes/items";
import EpisodesList from "./EpisodesList";
export default async function EpisodesSection({ anilistId, format, cover }: { anilistId:number; format:string|null; cover:string }) {
  if (format === "MANGA") return null;
  let stored = await getAnimeWithEpisodes(anilistId);
  if (needsImport(stored?.anime)) {
    const result = await Promise.race([importAnime(anilistId, { source:"open", timeoutMs:22000 }), new Promise<null>((resolve)=>setTimeout(()=>resolve(null),25000))]);
    if (result) stored = await getAnimeWithEpisodes(anilistId);
  }
  if (!stored || !stored.episodes?.length) return <p>Episodes are being prepared. Check back soon.</p>;
  if (stored.anime.not_found_on_anivexa || !stored.anime.has_streams) return <p>No streams available yet. We check again regularly.</p>;
  // Paged query + synopsis/thumbnail/duration metadata for every episode.
  const episodes = mapEpisodeRows(stored.episodes);
  return <EpisodesList anilistId={anilistId} format={format} cover={cover} episodes={episodes} />;
}
