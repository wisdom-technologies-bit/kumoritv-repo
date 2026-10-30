// Watch pages are only indexable when we actually hold the episode.
//
// `getEpisodeSeo` reports `source: "db"` exactly when the `episodes` row exists
// (it falls back to AniList metadata, then to a placeholder). An episode we do
// not store has nothing to play, so listing it in the sitemap or letting Google
// index it produces soft 404s.

import type { EpisodeSeo } from "./episode-seo";

export function episodeExistsInDb(
  seo: Pick<EpisodeSeo, "source"> | null | undefined,
): boolean {
  return seo?.source === "db";
}

export function watchRobots(episodeExists: boolean) {
  return episodeExists
    ? { index: true, follow: true }
    : { index: false, follow: false };
}
